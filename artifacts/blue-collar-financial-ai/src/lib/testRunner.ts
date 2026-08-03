/**
 * testRunner.ts
 *
 * Runs scanner test fixtures against the real scan API.
 * Compares extracted fields against expected values with per-type tolerances.
 * Supports concurrency (max 3), AbortSignal stop, and automatic retry.
 */

import { scanFile, type ScanResult } from './api';
import {
  generateSyntheticDocument,
  type ScannerTestFixture,
  type ExpectedField,
  type ToleranceType,
} from './testFixtures';
import { buildUpdatePlan } from './financialUpdater';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FieldResult {
  key: string;
  expected: ExpectedField;
  actual: string | number | null;
  confidence: number;
  pass: boolean;
}

export interface FullFlowResult {
  destinationSection: string;
  defaultAction: string;
  pass: boolean;
  detail: string;
}

export type TestStatus = 'pending' | 'running' | 'passed' | 'failed' | 'error';

export interface TestResult {
  fixtureId: string;
  status: TestStatus;
  docTypeActual: string | null;
  docTypeMatch: boolean;
  institutionActual: string | null;
  institutionMatch: boolean | null; // null when no expectation
  fieldResults: FieldResult[];
  routingActual: string | null;
  routingMatch: boolean;
  durationMs: number;
  retries: number;
  retryHistory: string[];
  error: string | null;
  errorStage: string | null;
  rawApiResponse: ScanResult | null;
  fullFlowResult: FullFlowResult | null;
  /** 0–1 fraction of passing checks */
  passRate: number;
}

export interface RunAllOptions {
  concurrency?: number;
  signal?: AbortSignal;
  onResult?: (result: TestResult) => void;
  onStart?: (fixtureId: string) => void;
}

// ─── Field comparison ─────────────────────────────────────────────────────────

function compareField(
  expected: ExpectedField,
  actual: string | number | null | undefined,
): boolean {
  if (actual === null || actual === undefined || actual === '') return false;

  if (typeof expected.value === 'number') {
    const n = typeof actual === 'number' ? actual : parseFloat(String(actual).replace(/[$,%]/g, ''));
    if (isNaN(n)) return false;
    const tol = expected.tolerance ?? 0.01;
    return Math.abs(n - expected.value) <= tol;
  }

  // Text comparison — case-insensitive, allow substring
  const aStr = String(actual).toLowerCase().trim();
  const eStr = String(expected.value).toLowerCase().trim();
  return aStr.includes(eStr) || eStr.includes(aStr);
}

// ─── Destination routing check ────────────────────────────────────────────────

/** Map doc type to expected destination section */
function routingDestination(docType: string): string {
  const dt = docType.toLowerCase();
  if (dt.includes('paystub')) return 'paystubs';
  if (
    dt.includes('bill') || dt.includes('utility') || dt.includes('subscription') ||
    dt.includes('insurance')
  ) return 'bills';
  if (
    dt.includes('credit card') || dt.includes('loan') || dt.includes('mortgage') ||
    dt.includes('heloc') || dt.includes('line of credit')
  ) return 'debts';
  // Default investment / banking → assets
  return 'assets';
}

// ─── Full flow check (TTCU + PSO) ────────────────────────────────────────────

function checkFullFlow(
  fixture: ScannerTestFixture,
  apiResult: ScanResult,
): FullFlowResult {
  const normalizeFieldValue = (v: string | number | boolean | null): string =>
    v === null || v === undefined ? '' : String(v);

  const docLike = {
    id: fixture.id,
    // file is required by the interface but not used by buildUpdatePlan logic;
    // pass a minimal stub so the type is satisfied.
    file: new File([], 'stub.jpg', { type: 'image/jpeg' }),
    accepted: true,
    status: 'done',
    docType: apiResult.docType,
    fields: Object.fromEntries(
      Object.entries(apiResult.fields).map(([k, f]) => [
        k,
        { value: normalizeFieldValue(f.value), confidence: f.confidence },
      ]),
    ),
    institutionName:
      apiResult.institution?.normalizedName ??
      apiResult.institution?.rawName ??
      '',
  };

  let plan;
  try {
    plan = buildUpdatePlan([docLike], { assets: [], debts: [], bills: [] });
  } catch (e) {
    return {
      destinationSection: 'error',
      defaultAction: 'error',
      pass: false,
      detail: `buildUpdatePlan threw: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const entry = plan.entries[0];
  if (!entry) {
    return {
      destinationSection: 'none',
      defaultAction: 'none',
      pass: false,
      detail: 'buildUpdatePlan returned no entries',
    };
  }

  const pass = entry.destinationSection === fixture.expectedDestination;
  return {
    destinationSection: entry.destinationSection,
    defaultAction: entry.defaultAction,
    pass,
    detail: pass
      ? `Routed to ${entry.destinationSection} with action=${entry.defaultAction}`
      : `Expected destination '${fixture.expectedDestination}', got '${entry.destinationSection}'`,
  };
}

// ─── Single fixture runner ────────────────────────────────────────────────────

const RETRY_DELAY_MS = [1000, 2000]; // per-retry wait

/** Returns true for errors that should NOT be retried (schema/classification). */
function isNonRetryableError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('schema') ||
    lower.includes('validation') ||
    lower.includes('invalid_image_format') ||
    lower.includes('unsupported image')
  );
}

export async function runFixture(
  fixture: ScannerTestFixture,
  signal?: AbortSignal,
): Promise<TestResult> {
  const start = performance.now();
  let retries = 0;
  const retryHistory: string[] = [];
  let lastError = '';
  let lastStage = '';
  let rawApiResponse: ScanResult | null = null;

  while (retries <= 2) {
    if (signal?.aborted) {
      return makeErrorResult(fixture, 'Stopped by user', 'stopped', start, retries, retryHistory, null);
    }

    try {
      const file = await generateSyntheticDocument(fixture);
      const result = await scanFile(file);
      rawApiResponse = result;

      // ── Classification check ──
      const docTypeMatch =
        result.docType.toLowerCase().includes(fixture.expectedDocType.toLowerCase()) ||
        fixture.expectedDocType.toLowerCase().includes(result.docType.toLowerCase());

      // ── Institution check ──
      let institutionMatch: boolean | null = null;
      let institutionActual: string | null = null;
      if (fixture.expectedInstitution) {
        institutionActual =
          result.institution?.normalizedName ?? result.institution?.rawName ?? null;
        institutionMatch = institutionActual
          ? institutionActual.toLowerCase().includes(fixture.expectedInstitution.toLowerCase()) ||
            fixture.expectedInstitution.toLowerCase().includes(institutionActual.toLowerCase())
          : false;
      }

      // ── Field extraction check ──
      const fieldResults: FieldResult[] = Object.entries(fixture.expectedFields).map(
        ([key, expected]) => {
          const apiField = result.fields[key];
          const actual = apiField?.value ?? null;
          const confidence = apiField?.confidence ?? 0;
          const pass = compareField(expected, actual as string | number | null);
          return { key, expected, actual: actual as string | number | null, confidence, pass };
        },
      );

      // ── Routing check ──
      const routingActual = routingDestination(result.docType);
      const routingMatch = routingActual === fixture.expectedDestination;

      // ── Full flow (TTCU + PSO) ──
      const fullFlowResult =
        fixture.fullFlowCheck ? checkFullFlow(fixture, result) : null;

      // ── Pass rate ──
      const checks: boolean[] = [
        docTypeMatch,
        ...(institutionMatch !== null ? [institutionMatch] : []),
        ...fieldResults.map(f => f.pass),
        routingMatch,
        ...(fullFlowResult ? [fullFlowResult.pass] : []),
      ];
      const passRate = checks.length > 0 ? checks.filter(Boolean).length / checks.length : 0;
      const status: TestStatus = passRate >= 1 ? 'passed' : passRate > 0 ? 'failed' : 'failed';

      return {
        fixtureId: fixture.id,
        status,
        docTypeActual: result.docType,
        docTypeMatch,
        institutionActual,
        institutionMatch,
        fieldResults,
        routingActual,
        routingMatch,
        durationMs: Math.round(performance.now() - start),
        retries,
        retryHistory,
        error: null,
        errorStage: null,
        rawApiResponse: result,
        fullFlowResult,
        passRate,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // Try to parse staged error messages from scanFile
      let stage = 'scan';
      try {
        const parsed = JSON.parse(msg);
        lastStage = parsed.stage ?? 'scan';
        lastError = parsed.message ?? msg;
        stage = lastStage;
      } catch {
        lastError = msg;
        lastStage = 'scan';
        stage = 'scan';
      }

      if (isNonRetryableError(lastError)) break;

      retries++;
      if (retries <= 2) {
        retryHistory.push(`Attempt ${retries}: ${lastError}`);
        await sleep(RETRY_DELAY_MS[retries - 1] ?? 2000);
      }
    }
  }

  return makeErrorResult(fixture, lastError, lastStage, start, retries, retryHistory, rawApiResponse);
}

function makeErrorResult(
  fixture: ScannerTestFixture,
  error: string,
  stage: string,
  start: number,
  retries: number,
  retryHistory: string[],
  raw: ScanResult | null,
): TestResult {
  return {
    fixtureId: fixture.id,
    status: 'error',
    docTypeActual: null,
    docTypeMatch: false,
    institutionActual: null,
    institutionMatch: fixture.expectedInstitution ? false : null,
    fieldResults: Object.keys(fixture.expectedFields).map(key => ({
      key,
      expected: fixture.expectedFields[key],
      actual: null,
      confidence: 0,
      pass: false,
    })),
    routingActual: null,
    routingMatch: false,
    durationMs: Math.round(performance.now() - start),
    retries,
    retryHistory,
    error,
    errorStage: stage,
    rawApiResponse: raw,
    fullFlowResult: null,
    passRate: 0,
  };
}

// ─── Multi-fixture runner ─────────────────────────────────────────────────────

export async function runAll(
  fixtures: ScannerTestFixture[],
  options: RunAllOptions = {},
): Promise<void> {
  const { concurrency = 2, signal, onResult, onStart } = options;
  const clampedConcurrency = Math.min(Math.max(concurrency, 1), 3);
  const queue = [...fixtures];

  async function worker() {
    while (queue.length > 0) {
      if (signal?.aborted) break;
      const fixture = queue.shift();
      if (!fixture) break;
      onStart?.(fixture.id);
      const result = await runFixture(fixture, signal);
      onResult?.(result);
    }
  }

  await Promise.all(Array.from({ length: clampedConcurrency }, worker));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
