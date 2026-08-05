import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TAX_FILING_STATUSES,
  US_STATE_CODES,
} from '../profile-context-api';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.resolve(here, '../profile-context-api.ts'),
  'utf8',
);

describe('profile-context-api', () => {
  it('includes all 50 states and DC exactly once', () => {
    expect(US_STATE_CODES.length).toBe(51);
    expect(new Set(US_STATE_CODES).size).toBe(51);
    expect(US_STATE_CODES).toContain('OK');
    expect(US_STATE_CODES).toContain('DC');
  });

  it('exposes the four supported filing statuses', () => {
    expect(TAX_FILING_STATUSES).toEqual([
      'Single',
      'Married Filing Jointly',
      'Married Filing Separately',
      'Head of Household',
    ]);
  });

  it('always sends the Clerk bearer token', () => {
    expect(source).toMatch(/Authorization:\s*`Bearer \$\{token\}`/);
  });

  it('uses the authenticated profile-context endpoint', () => {
    expect(source).toMatch(/\/api/);
    expect(source).toMatch(/\/profile-context/);
    // Verify no "userId" JSON key is sent in the request body (interface field is fine)
    expect(source).not.toMatch(/"userId"\s*:/);
  });

  it('uses PUT for validated context updates', () => {
    expect(source).toMatch(/method:\s*"PUT"/);
    expect(source).toMatch(/JSON\.stringify\(input\)/);
  });
});
