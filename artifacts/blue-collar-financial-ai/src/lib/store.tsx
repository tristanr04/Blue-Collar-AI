import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@clerk/react';
import { sortPaystubsNewestFirst } from './financial-calculations';
import {
  loadSnapshot,
  saveProfile,
  createRecord,
  updateRecord,
  deleteRecord,
  type FinancialSnapshot,
} from './api';

export type PayFrequency = 'Weekly' | 'Bi-Weekly' | 'Semi-Monthly' | 'Monthly';
export type FilingContext = 'Single' | 'Married' | 'Head of Household';

export interface Profile {
  name: string;
  payFrequency: PayFrequency;
  hourlyRate: number;
  filingContext: FilingContext;
  hasCompletedOnboarding: boolean;
}

export interface Paystub {
  id: string;
  date: string;
  employer: string;
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  perDiem: number;
  grossPay: number;
  netPay: number;
  taxes: number;
  deductions: number;
}

export interface Debt {
  id: string;
  name: string;
  balance: number;
  interestRate: number;
  minimumPayment: number;
  /** Set from scanned revolving-credit accounts */
  isRevolving?: boolean;
  /** Credit card / revolving account limit */
  creditLimit?: number;
  /** Optional — set from scanned docs for smart matching */
  institutionName?: string;
  lastFour?: string;
  lastUpdatedAt?: string;
}

export interface Bill {
  id: string;
  name: string;
  amount: number;
  dueDate: number; // Day of month (1-31)
  isAutoPay: boolean;
  /** Normalized provider name for matching */
  providerNormalized?: string;
  lastUpdatedAt?: string;
}

export interface Asset {
  id: string;
  name: string;
  type: 'Cash' | 'Investment' | 'Other';
  value: number;
  /** Optional — set from scanned docs for smart matching */
  institutionName?: string;
  lastFour?: string;
  lastUpdatedAt?: string;
}

export interface ScannedDocument {
  id: string;
  date: string;
  type: 'Paystub' | 'Bill' | 'Other';
  status: 'Pending Review' | 'Processed' | 'Rejected';
  data?: any;
  /** SHA-256 hex fingerprint — used for client-side and server-side duplicate detection */
  fingerprint?: string;
}

/** One field-level change created by a confirmed document import. */
export interface FinancialChangeRecord {
  id: string;
  timestamp: string;
  sourceDocumentId: string;
  sourceFilename: string;
  destinationSection: string;
  recordId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  userConfirmed: boolean;
}

/** Cached derived metrics — updated after every confirmed import. */
export interface ComputedMetrics {
  monthlyNet: number;
  monthlyGross: number;
  totalBills: number;
  totalDebtMin: number;
  freeCashFlow: number;
  liquidCash: number;
  totalInvestments: number;
  retirementTotal: number;
  totalDebt: number;
  netWorth: number;
  healthScore: number;
  /** Debt-to-income ratio using GROSS monthly income (lender-standard). */
  dti: number;
  emergencyMonths: number;
}

// ─── computeMetrics (pure, exported for tests) ────────────────────────────────

export function computeMetrics(
  s: Pick<StoreState, 'profile' | 'paystubs' | 'debts' | 'bills' | 'assets'>,
): ComputedMetrics {
  const { profile, paystubs, debts, bills, assets } = s;
  const freqMult: Record<string, number> = { Weekly: 4.33, 'Bi-Weekly': 2.17, 'Semi-Monthly': 2, Monthly: 1 };
  const mult = freqMult[profile?.payFrequency ?? 'Weekly'] ?? 4.33;

  const latest = sortPaystubsNewestFirst(paystubs)[0];
  const monthlyNet = Math.round((latest?.netPay ?? 0) * mult);
  const monthlyGross = Math.round((latest?.grossPay ?? 0) * mult);
  const totalBills = bills.reduce((s, b) => s + (b.amount ?? 0), 0);
  const totalDebtMin = debts.reduce((s, d) => s + (d.minimumPayment ?? 0), 0);
  const freeCashFlow = monthlyNet - totalBills - totalDebtMin;
  const liquidCash = assets.filter(a => a.type === 'Cash').reduce((s, a) => s + a.value, 0);
  const totalInvestments = assets.filter(a => a.type === 'Investment').reduce((s, a) => s + a.value, 0);
  const retirementTotal = assets
    .filter(a => a.type === 'Investment' && /401|ira|pension|retirement|tsp|403b|457/i.test(a.name))
    .reduce((s, a) => s + a.value, 0);
  const totalDebt = debts.reduce((s, d) => s + d.balance, 0);
  const netWorth = assets.reduce((s, a) => s + a.value, 0) - totalDebt;
  const dti = monthlyGross > 0 ? (totalDebtMin / monthlyGross) * 100 : 0;
  const monthlyExpenses = totalBills + totalDebtMin;
  // When the user has cash but no monthly expenses, coverage is effectively infinite
  // rather than zero (dividing by zero would show "0 months" which is wrong).
  const emergencyMonths = monthlyExpenses > 0
    ? Math.round((liquidCash / monthlyExpenses) * 10) / 10
    : liquidCash > 0 ? Infinity : 0;

  let healthScore = 0;
  if (monthlyNet > 0 && paystubs.length > 0) {
    let score = 0;
    const maxPts = 90;
    const ratio = freeCashFlow / monthlyNet;
    if (ratio >= 0.2) score += 20; else if (ratio > 0) score += Math.round((ratio / 0.2) * 20);
    // Same Infinity guard: no expenses + cash present → maximum emergency score.
    const emM = monthlyExpenses > 0 ? liquidCash / monthlyExpenses : (liquidCash > 0 ? Infinity : 0);
    if (emM >= 6) score += 20; else if (emM >= 3) score += 14; else if (emM >= 1) score += 7;
    const hiB = debts.filter(d => (d.interestRate ?? 0) > 10).reduce((s, d) => s + d.balance, 0);
    const util = Math.min(hiB / 10000, 1);
    if (util < 0.3) score += 15; else if (util < 0.6) score += 8;
    const dtiR = monthlyGross > 0 ? totalDebtMin / monthlyGross : 1;
    if (dtiR <= 0.15) score += 15; else if (dtiR <= 0.28) score += 10; else if (dtiR <= 0.36) score += 5;
    const hiCount = debts.filter(d => (d.interestRate ?? 0) > 15).length;
    if (hiCount === 0) score += 10; else if (hiCount === 1) score += 4;
    if (retirementTotal > 0) score += 10;
    healthScore = Math.round((score / maxPts) * 100);
  }

  return { monthlyNet, monthlyGross, totalBills, totalDebtMin, freeCashFlow, liquidCash, totalInvestments, retirementTotal, totalDebt, netWorth, healthScore, dti, emergencyMonths };
}

const EMPTY_METRICS: ComputedMetrics = {
  monthlyNet: 0, monthlyGross: 0, totalBills: 0, totalDebtMin: 0,
  freeCashFlow: 0, liquidCash: 0, totalInvestments: 0, retirementTotal: 0,
  totalDebt: 0, netWorth: 0, healthScore: 0, dti: 0, emergencyMonths: 0,
};

// ─── State & context ──────────────────────────────────────────────────────────

interface StoreState {
  profile: Profile | null;
  paystubs: Paystub[];
  debts: Debt[];
  bills: Bill[];
  assets: Asset[];
  documents: ScannedDocument[];
  changeHistory: FinancialChangeRecord[];
  computed: ComputedMetrics;
}

interface StoreContextType extends StoreState {
  updateProfile: (profile: Partial<Profile>) => void;
  addPaystub: (paystub: Omit<Paystub, 'id'>) => string;
  removePaystub: (id: string) => void;
  addDebt: (debt: Omit<Debt, 'id'>) => string;
  removeDebt: (id: string) => void;
  updateDebt: (id: string, updates: Partial<Debt>) => void;
  addBill: (bill: Omit<Bill, 'id'>) => string;
  removeBill: (id: string) => void;
  updateBill: (id: string, updates: Partial<Bill>) => void;
  addAsset: (asset: Omit<Asset, 'id'>) => string;
  removeAsset: (id: string) => void;
  updateAsset: (id: string, updates: Partial<Asset>) => void;
  addDocument: (doc: Omit<ScannedDocument, 'id' | 'date'>) => void;
  updateDocument: (id: string, updates: Partial<ScannedDocument>) => void;
  removeDocument: (id: string) => void;
  addChangeRecords: (records: FinancialChangeRecord[]) => void;
  undoImport: (sourceDocumentId: string) => void;
  restoreFieldValue: (changeId: string) => void;
  resetToDemo: () => void;
  clearAll: () => void;
  isLoadingFromServer: boolean;
  migrationPending: boolean;
  migrateLocalToServer: () => Promise<void>;
  dismissMigration: () => void;
}

// ─── Demo & default state ─────────────────────────────────────────────────────

const DEMO_BASE = {
  profile: {
    name: 'Mike', payFrequency: 'Weekly' as PayFrequency, hourlyRate: 35.50,
    filingContext: 'Married' as FilingContext, hasCompletedOnboarding: true,
  },
  paystubs: [{
    id: 'p1', date: new Date().toISOString(), employer: 'United Construction',
    regularHours: 40, overtimeHours: 8, doubleTimeHours: 0, perDiem: 150,
    grossPay: 1854, taxes: 350, deductions: 120, netPay: 1384,
  }],
  debts: [
    { id: 'd1', name: 'F-150 Auto Loan', balance: 24500, interestRate: 5.5, minimumPayment: 480 },
    { id: 'd2', name: 'Credit Card (Tools)', balance: 3200, interestRate: 19.9, minimumPayment: 110, isRevolving: true, creditLimit: 5000 },
  ],
  bills: [
    { id: 'b1', name: 'Rent', amount: 1600, dueDate: 1, isAutoPay: true },
    { id: 'b2', name: 'Phone', amount: 95, dueDate: 15, isAutoPay: true },
    { id: 'b3', name: 'Insurance', amount: 145, dueDate: 20, isAutoPay: false },
  ],
  assets: [
    { id: 'a1', name: 'Checking', type: 'Cash' as const, value: 2450 },
    { id: 'a2', name: 'Emergency Fund', type: 'Cash' as const, value: 5000 },
    { id: 'a3', name: 'Union 401k', type: 'Investment' as const, value: 14500 },
  ],
  documents: [
    { id: 'doc1', date: new Date().toISOString(), type: 'Paystub' as const, status: 'Pending Review' as const },
  ],
  changeHistory: [] as FinancialChangeRecord[],
};

const DEMO_STATE: StoreState = { ...DEMO_BASE, computed: computeMetrics(DEMO_BASE) };

const DEFAULT_STATE: StoreState = {
  profile: null, paystubs: [], debts: [], bills: [], assets: [], documents: [],
  changeHistory: [], computed: EMPTY_METRICS,
};

// ─── Provider ─────────────────────────────────────────────────────────────────

const StoreContext = createContext<StoreContextType | null>(null);

function migrateState(raw: any): StoreState {
  const base = {
    ...DEFAULT_STATE, ...raw,
    changeHistory: raw.changeHistory ?? [],
    paystubs: raw.paystubs ?? [],
    debts: raw.debts ?? [],
    bills: raw.bills ?? [],
    assets: raw.assets ?? [],
    documents: raw.documents ?? [],
  };
  base.computed = computeMetrics(base);
  return base;
}

function withComputed(patch: Partial<StoreState>, prev: StoreState): StoreState {
  const next = { ...prev, ...patch };
  next.computed = computeMetrics(next);
  return next;
}

// ─── Server ↔ Store data mappers ──────────────────────────────────────────────

function mapSnapshotToState(snapshot: FinancialSnapshot): Partial<StoreState> {
  const prof = snapshot.profile as any;
  return {
    profile: prof ? {
      name: prof.name ?? '',
      payFrequency: (prof.payFrequency ?? 'Weekly') as PayFrequency,
      hourlyRate: Number(prof.hourlyRate ?? 0),
      filingContext: (prof.filingContext ?? 'Single') as FilingContext,
      hasCompletedOnboarding: Boolean(prof.hasCompletedOnboarding),
    } : null,
    paystubs: (snapshot.paystubs as any[]).map((p) => ({
      id: p.id,
      date: p.payDate ? String(p.payDate) : new Date().toISOString(),
      employer: p.employer ?? '',
      regularHours: Number(p.regularHours ?? 0),
      overtimeHours: Number(p.overtimeHours ?? 0),
      doubleTimeHours: Number(p.doubleTimeHours ?? 0),
      perDiem: Number(p.perDiem ?? 0),
      grossPay: Number(p.grossPay ?? 0),
      netPay: Number(p.netPay ?? 0),
      taxes: Number(p.taxes ?? 0),
      deductions: Number(p.deductions ?? 0),
    })),
    debts: (snapshot.debts as any[]).map((d) => ({
      id: d.id,
      name: d.name,
      balance: Number(d.balance ?? 0),
      interestRate: Number(d.interestRate ?? 0),
      minimumPayment: Number(d.minimumPayment ?? 0),
      isRevolving: Boolean(d.isRevolving),
      creditLimit: d.creditLimit != null ? Number(d.creditLimit) : undefined,
      institutionName: d.institutionName ?? undefined,
      lastFour: d.lastFour ?? undefined,
    })),
    bills: (snapshot.bills as any[]).map((b) => ({
      id: b.id,
      name: b.name,
      amount: Number(b.amount ?? 0),
      dueDate: Number(b.dueDay ?? 1),
      isAutoPay: Boolean(b.isAutoPay),
      providerNormalized: b.providerNormalized ?? undefined,
    })),
    assets: (snapshot.assets as any[]).map((a) => ({
      id: a.id,
      name: a.name,
      type: (a.type ?? 'Other') as 'Cash' | 'Investment' | 'Other',
      value: Number(a.value ?? 0),
      institutionName: a.institutionName ?? undefined,
      lastFour: a.lastFour ?? undefined,
    })),
  };
}

function paystubToApi(p: Omit<Paystub, 'id'>): Record<string, unknown> {
  return {
    employer: p.employer, payDate: p.date,
    regularHours: p.regularHours, overtimeHours: p.overtimeHours,
    doubleTimeHours: p.doubleTimeHours, perDiem: p.perDiem,
    grossPay: p.grossPay, netPay: p.netPay,
    taxes: p.taxes, deductions: p.deductions,
  };
}
function debtToApi(d: Partial<Omit<Debt, 'id'>>): Record<string, unknown> {
  return {
    ...(d.name !== undefined && { name: d.name }),
    ...(d.balance !== undefined && { balance: d.balance }),
    ...(d.interestRate !== undefined && { interestRate: d.interestRate }),
    ...(d.minimumPayment !== undefined && { minimumPayment: d.minimumPayment }),
    isRevolving: d.isRevolving ?? false,
    creditLimit: d.creditLimit ?? null,
    institutionName: d.institutionName ?? null,
    lastFour: d.lastFour ?? null,
  };
}
function billToApi(b: Partial<Omit<Bill, 'id'>>): Record<string, unknown> {
  return {
    ...(b.name !== undefined && { name: b.name }),
    ...(b.amount !== undefined && { amount: b.amount }),
    ...(b.dueDate !== undefined && { dueDay: b.dueDate }),
    ...(b.isAutoPay !== undefined && { isAutoPay: b.isAutoPay }),
    providerNormalized: b.providerNormalized ?? null,
  };
}
function assetToApi(a: Partial<Omit<Asset, 'id'>>): Record<string, unknown> {
  return {
    ...(a.name !== undefined && { name: a.name }),
    ...(a.type !== undefined && { type: a.type }),
    ...(a.value !== undefined && { value: a.value }),
    institutionName: a.institutionName ?? null,
    lastFour: a.lastFour ?? null,
  };
}
function profileToApi(p: Profile): Record<string, unknown> {
  return {
    name: p.name, payFrequency: p.payFrequency, hourlyRate: p.hourlyRate,
    filingContext: p.filingContext, hasCompletedOnboarding: p.hasCompletedOnboarding,
  };
}

// ─── StoreProvider ────────────────────────────────────────────────────────────

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<StoreState>(() => {
    try {
      const stored = localStorage.getItem('bcf_state');
      if (stored) return migrateState(JSON.parse(stored));
    } catch (e) {
      console.error('Failed to parse state', e);
    }
    return DEFAULT_STATE;
  });

  useEffect(() => {
    localStorage.setItem('bcf_state', JSON.stringify(state));
  }, [state]);

  // ─── Auth ─────────────────────────────────────────────────────────────────

  const { isLoaded, isSignedIn, getToken } = useAuth();
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) { tokenRef.current = null; return; }
    const refresh = () => getToken().then(t => { tokenRef.current = t; }).catch(() => {});
    refresh();
    const id = setInterval(refresh, 50_000);
    return () => clearInterval(id);
  }, [isLoaded, isSignedIn, getToken]);

  // ─── Local→Server UUID resolution map ─────────────────────────────────────
  // Maps a temporary local UUID to a Promise that resolves with the server UUID.
  // delete/update operations chain on this promise so they always use the real UUID.
  const idPendingMap = useRef<Map<string, Promise<string>>>(new Map());

  // ─── Server snapshot on sign-in ───────────────────────────────────────────

  const [serverSynced, setServerSynced] = useState(false);
  const [isLoadingFromServer, setIsLoadingFromServer] = useState(false);
  const [migrationPending, setMigrationPending] = useState(false);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; });

  useEffect(() => {
    if (isLoaded && !isSignedIn) { setServerSynced(false); setMigrationPending(false); }
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || serverSynced) return;
    let cancelled = false;
    (async () => {
      const token = await getToken();
      if (!token || cancelled) return;
      setIsLoadingFromServer(true);
      try {
        const snapshot = await loadSnapshot(token);
        if (cancelled) return;
        const hasServerData = Boolean(
          snapshot.profile || snapshot.paystubs?.length ||
          snapshot.debts?.length || snapshot.bills?.length || snapshot.assets?.length,
        );
        if (hasServerData) {
          setState(migrateState({ ...DEFAULT_STATE, ...mapSnapshotToState(snapshot) }));
        } else {
          const cur = stateRef.current;
          const hasLocalData = cur.paystubs.length > 0 || cur.debts.length > 0 ||
            cur.bills.length > 0 || cur.assets.length > 0;
          if (hasLocalData) setMigrationPending(true);
        }
      } catch (err) {
        console.error('[store] Failed to load server snapshot:', err);
      } finally {
        if (!cancelled) { setIsLoadingFromServer(false); setServerSynced(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [isLoaded, isSignedIn, serverSynced, getToken]);

  // ─── Migration ─────────────────────────────────────────────────────────────

  const migrateLocalToServer = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) throw new Error('Not signed in');
    const cur = stateRef.current;
    if (cur.profile) await saveProfile(token, profileToApi(cur.profile));
    for (const p of cur.paystubs) await createRecord(token, 'paystubs', paystubToApi(p));
    for (const d of cur.debts) await createRecord(token, 'debts', debtToApi(d));
    for (const b of cur.bills) await createRecord(token, 'bills', billToApi(b));
    for (const a of cur.assets) await createRecord(token, 'assets', assetToApi(a));
    setMigrationPending(false);
    setServerSynced(false); // reload to unify IDs
  }, []);

  const dismissMigration = useCallback(() => setMigrationPending(false), []);

  // ─── Sync helpers ─────────────────────────────────────────────────────────

  /**
   * Fire a simple background write (profile save, or any non-create operation
   * that doesn't need UUID resolution).
   */
  const bgSync = useCallback((fn: (token: string) => Promise<unknown>) => {
    const token = tokenRef.current;
    if (!token) return;
    fn(token).catch(err => console.error('[store] sync failed:', err));
  }, []);

  /**
   * Fire a CREATE call in the background. When the server responds with the
   * real UUID, replace the temporary localId in state and in changeHistory.
   * The Promise in idPendingMap resolves with the server UUID so that any
   * delete/update queued before the response arrives uses the correct ID.
   */
  const bgCreate = useCallback(<T extends { id: string }>(
    localId: string,
    section: 'paystubs' | 'debts' | 'bills' | 'assets',
    fn: (token: string) => Promise<T>,
    buildPatch: (prev: StoreState, serverId: string) => Partial<StoreState>,
  ) => {
    const token = tokenRef.current;
    if (!token) return;

    const promise = fn(token)
      .then(result => {
        const serverId = result.id;
        setState(prev => withComputed(buildPatch(prev, serverId), prev));
        idPendingMap.current.delete(localId);
        return serverId;
      })
      .catch(err => {
        console.error(`[store] ${section} create sync failed:`, err);
        idPendingMap.current.delete(localId);
        return localId; // keep local ID on failure — next server load will reconcile
      });

    idPendingMap.current.set(localId, promise);
  }, []);

  /**
   * Fire a DELETE or UPDATE call, waiting for any in-flight create on the same
   * record to finish first so the server UUID is always used.
   */
  const bgWithIdSync = useCallback((
    localId: string,
    fn: (token: string, resolvedId: string) => Promise<unknown>,
  ) => {
    const token = tokenRef.current;
    if (!token) return;

    const exec = (serverId: string) =>
      fn(token, serverId).catch(err => console.error('[store] sync failed:', err));

    const pending = idPendingMap.current.get(localId);
    if (pending) {
      pending.then(exec).catch(() => {});
    } else {
      exec(localId);
    }
  }, []);

  // ─── Profile ──────────────────────────────────────────────────────────────

  const updateProfile = useCallback((profileUpdates: Partial<Profile>) => {
    setState(prev => {
      const next = prev.profile
        ? { ...prev.profile, ...profileUpdates }
        : { name: '', payFrequency: 'Weekly' as PayFrequency, hourlyRate: 0, filingContext: 'Single' as FilingContext, hasCompletedOnboarding: false, ...profileUpdates } as Profile;
      bgSync(t => saveProfile(t, profileToApi(next)));
      return withComputed({ profile: next }, prev);
    });
  }, [bgSync]);

  // ─── Paystubs ─────────────────────────────────────────────────────────────

  const addPaystub = useCallback((paystub: Omit<Paystub, 'id'>): string => {
    const localId = crypto.randomUUID();
    setState(prev => withComputed({ paystubs: [...prev.paystubs, { ...paystub, id: localId }] }, prev));
    bgCreate(localId, 'paystubs', t => createRecord(t, 'paystubs', paystubToApi(paystub)), (prev, serverId) => ({
      paystubs: prev.paystubs.map(p => p.id === localId ? { ...p, id: serverId } : p),
      changeHistory: prev.changeHistory.map(r => r.recordId === localId ? { ...r, recordId: serverId } : r),
    }));
    return localId;
  }, [bgCreate]);

  const removePaystub = useCallback((id: string) => {
    setState(prev => withComputed({ paystubs: prev.paystubs.filter(p => p.id !== id) }, prev));
    bgWithIdSync(id, (t, serverId) => deleteRecord(t, 'paystubs', serverId));
  }, [bgWithIdSync]);

  // ─── Debts ────────────────────────────────────────────────────────────────

  const addDebt = useCallback((debt: Omit<Debt, 'id'>): string => {
    const localId = crypto.randomUUID();
    setState(prev => withComputed({ debts: [...prev.debts, { ...debt, id: localId }] }, prev));
    bgCreate(localId, 'debts', t => createRecord(t, 'debts', debtToApi(debt)), (prev, serverId) => ({
      debts: prev.debts.map(d => d.id === localId ? { ...d, id: serverId } : d),
      changeHistory: prev.changeHistory.map(r => r.recordId === localId ? { ...r, recordId: serverId } : r),
    }));
    return localId;
  }, [bgCreate]);

  const removeDebt = useCallback((id: string) => {
    setState(prev => withComputed({ debts: prev.debts.filter(d => d.id !== id) }, prev));
    bgWithIdSync(id, (t, serverId) => deleteRecord(t, 'debts', serverId));
  }, [bgWithIdSync]);

  const updateDebt = useCallback((id: string, updates: Partial<Debt>) => {
    setState(prev => withComputed({ debts: prev.debts.map(d => d.id === id ? { ...d, ...updates } : d) }, prev));
    bgWithIdSync(id, (t, serverId) => updateRecord(t, 'debts', serverId, debtToApi(updates)));
  }, [bgWithIdSync]);

  // ─── Bills ────────────────────────────────────────────────────────────────

  const addBill = useCallback((bill: Omit<Bill, 'id'>): string => {
    const localId = crypto.randomUUID();
    setState(prev => withComputed({ bills: [...prev.bills, { ...bill, id: localId }] }, prev));
    bgCreate(localId, 'bills', t => createRecord(t, 'bills', billToApi(bill)), (prev, serverId) => ({
      bills: prev.bills.map(b => b.id === localId ? { ...b, id: serverId } : b),
      changeHistory: prev.changeHistory.map(r => r.recordId === localId ? { ...r, recordId: serverId } : r),
    }));
    return localId;
  }, [bgCreate]);

  const removeBill = useCallback((id: string) => {
    setState(prev => withComputed({ bills: prev.bills.filter(b => b.id !== id) }, prev));
    bgWithIdSync(id, (t, serverId) => deleteRecord(t, 'bills', serverId));
  }, [bgWithIdSync]);

  const updateBill = useCallback((id: string, updates: Partial<Bill>) => {
    setState(prev => withComputed({ bills: prev.bills.map(b => b.id === id ? { ...b, ...updates } : b) }, prev));
    bgWithIdSync(id, (t, serverId) => updateRecord(t, 'bills', serverId, billToApi(updates)));
  }, [bgWithIdSync]);

  // ─── Assets ───────────────────────────────────────────────────────────────

  const addAsset = useCallback((asset: Omit<Asset, 'id'>): string => {
    const localId = crypto.randomUUID();
    setState(prev => withComputed({ assets: [...prev.assets, { ...asset, id: localId }] }, prev));
    bgCreate(localId, 'assets', t => createRecord(t, 'assets', assetToApi(asset)), (prev, serverId) => ({
      assets: prev.assets.map(a => a.id === localId ? { ...a, id: serverId } : a),
      changeHistory: prev.changeHistory.map(r => r.recordId === localId ? { ...r, recordId: serverId } : r),
    }));
    return localId;
  }, [bgCreate]);

  const removeAsset = useCallback((id: string) => {
    setState(prev => withComputed({ assets: prev.assets.filter(a => a.id !== id) }, prev));
    bgWithIdSync(id, (t, serverId) => deleteRecord(t, 'assets', serverId));
  }, [bgWithIdSync]);

  const updateAsset = useCallback((id: string, updates: Partial<Asset>) => {
    setState(prev => withComputed({ assets: prev.assets.map(a => a.id === id ? { ...a, ...updates } : a) }, prev));
    bgWithIdSync(id, (t, serverId) => updateRecord(t, 'assets', serverId, assetToApi(updates)));
  }, [bgWithIdSync]);

  // ─── Documents ────────────────────────────────────────────────────────────

  const addDocument = useCallback((doc: Omit<ScannedDocument, 'id' | 'date'>) => {
    setState(prev => ({
      ...prev,
      documents: [...prev.documents, { ...doc, date: new Date().toISOString(), id: crypto.randomUUID() }],
    }));
  }, []);

  const updateDocument = useCallback((id: string, updates: Partial<ScannedDocument>) => {
    setState(prev => ({ ...prev, documents: prev.documents.map(d => d.id === id ? { ...d, ...updates } : d) }));
  }, []);

  const removeDocument = useCallback((id: string) => {
    setState(prev => ({ ...prev, documents: prev.documents.filter(d => d.id !== id) }));
  }, []);

  // ─── Change history ───────────────────────────────────────────────────────

  const addChangeRecords = useCallback((records: FinancialChangeRecord[]) => {
    if (records.length === 0) return;
    setState(prev => ({ ...prev, changeHistory: [...prev.changeHistory, ...records] }));
  }, []);

  const undoImport = useCallback((sourceDocumentId: string) => {
    setState(prev => {
      const toUndo = prev.changeHistory.filter(r => r.sourceDocumentId === sourceDocumentId);
      if (toUndo.length === 0) return prev;
      let assets = [...prev.assets], debts = [...prev.debts], bills = [...prev.bills], paystubs = [...prev.paystubs];
      for (const rec of [...toUndo].reverse()) {
        if (rec.field === 'created') {
          if (rec.destinationSection === 'assets') assets = assets.filter(a => a.id !== rec.recordId);
          else if (rec.destinationSection === 'debts') debts = debts.filter(d => d.id !== rec.recordId);
          else if (rec.destinationSection === 'bills') bills = bills.filter(b => b.id !== rec.recordId);
          else if (rec.destinationSection === 'paystubs') paystubs = paystubs.filter(p => p.id !== rec.recordId);
        } else if (rec.oldValue !== null && rec.oldValue !== undefined) {
          if (rec.destinationSection === 'assets') assets = assets.map(a => a.id === rec.recordId ? { ...a, [rec.field]: rec.oldValue } : a);
          else if (rec.destinationSection === 'debts') debts = debts.map(d => d.id === rec.recordId ? { ...d, [rec.field]: rec.oldValue } : d);
          else if (rec.destinationSection === 'bills') bills = bills.map(b => b.id === rec.recordId ? { ...b, [rec.field]: rec.oldValue } : b);
        }
      }
      const changeHistory = prev.changeHistory.filter(r => r.sourceDocumentId !== sourceDocumentId);
      return withComputed({ assets, debts, bills, paystubs, changeHistory }, prev);
    });
  }, []);

  const restoreFieldValue = useCallback((changeId: string) => {
    setState(prev => {
      const rec = prev.changeHistory.find(r => r.id === changeId);
      if (!rec || rec.field === 'created' || rec.oldValue === null || rec.oldValue === undefined) return prev;
      let assets = prev.assets, debts = prev.debts, bills = prev.bills;
      if (rec.destinationSection === 'assets') assets = assets.map(a => a.id === rec.recordId ? { ...a, [rec.field]: rec.oldValue } : a);
      else if (rec.destinationSection === 'debts') debts = debts.map(d => d.id === rec.recordId ? { ...d, [rec.field]: rec.oldValue } : d);
      else if (rec.destinationSection === 'bills') bills = bills.map(b => b.id === rec.recordId ? { ...b, [rec.field]: rec.oldValue } : b);
      const changeHistory = prev.changeHistory.filter(r => r.id !== changeId);
      return withComputed({ assets, debts, bills, changeHistory }, prev);
    });
  }, []);

  const resetToDemo = useCallback(() => setState(DEMO_STATE), []);
  const clearAll = useCallback(() => setState(DEFAULT_STATE), []);

  return (
    <StoreContext.Provider value={{
      ...state,
      updateProfile,
      addPaystub, removePaystub,
      addDebt, removeDebt, updateDebt,
      addBill, removeBill, updateBill,
      addAsset, removeAsset, updateAsset,
      addDocument, updateDocument, removeDocument,
      addChangeRecords, undoImport, restoreFieldValue,
      resetToDemo, clearAll,
      isLoadingFromServer, migrationPending, migrateLocalToServer, dismissMigration,
    }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore must be used within StoreProvider');
  return context;
}
