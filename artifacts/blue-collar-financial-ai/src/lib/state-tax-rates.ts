/**
 * 2026 State Income Tax Rate Data
 *
 * Sources: tax foundation, individual state DOR websites.
 * Rates are for 2026 tax year (or best estimate where 2026 not published).
 * Filing-status distinctions are included where the difference is material.
 * All income figures are taxable income (after state standard deduction, if any).
 *
 * This is an estimation module — recommend a tax professional for final filing.
 */

export type FilingStatus =
  | 'Single'
  | 'Married Filing Jointly'
  | 'Married Filing Separately'
  | 'Head of Household';

export type StateTaxType = 'none' | 'flat' | 'brackets';

export interface StateBracket {
  rate: number;  // decimal, e.g. 0.05 = 5%
  from: number;  // income at or above this amount (0 for first bracket)
  to: number;    // income below this amount (Infinity for top bracket)
}

export interface StateTaxEntry {
  name: string;
  type: StateTaxType;
  flatRate?: number;                         // for type = 'flat'
  brackets?: {                               // for type = 'brackets'
    single: StateBracket[];
    joint: StateBracket[];
    hoh?: StateBracket[];                    // if omitted, use single
  };
  note?: string;                             // disclaimer or nuance
}

/** Build brackets for a flat-rate state (single array for all statuses). */
function flat(rate: number): StateBracket[] {
  return [{ rate, from: 0, to: Infinity }];
}

/** Shared brackets (same for all filing statuses). */
function shared(brackets: StateBracket[]): StateTaxEntry['brackets'] {
  return { single: brackets, joint: brackets };
}

/**
 * State income tax entries indexed by 2-letter state code + 'DC'.
 * States with no income tax have type = 'none'.
 */
export const STATE_TAX_RATES: Record<string, StateTaxEntry> = {

  // ─── No income tax states ──────────────────────────────────────────────────
  AK: { name: 'Alaska',      type: 'none' },
  FL: { name: 'Florida',     type: 'none' },
  NV: { name: 'Nevada',      type: 'none' },
  NH: { name: 'New Hampshire', type: 'none', note: 'No tax on wages; investment income tax being phased out.' },
  SD: { name: 'South Dakota', type: 'none' },
  TN: { name: 'Tennessee',   type: 'none', note: 'No tax on wages since 2021.' },
  TX: { name: 'Texas',       type: 'none' },
  WA: { name: 'Washington',  type: 'none', note: 'No income tax on wages. 7% capital-gains tax on gains >$262,000.' },
  WY: { name: 'Wyoming',     type: 'none' },

  // ─── Flat-rate states ──────────────────────────────────────────────────────
  AZ: { name: 'Arizona',     type: 'flat', flatRate: 0.025, note: '2.5% flat rate (2023+).' },
  CO: { name: 'Colorado',    type: 'flat', flatRate: 0.044 },
  IL: { name: 'Illinois',    type: 'flat', flatRate: 0.0495 },
  IN: { name: 'Indiana',     type: 'flat', flatRate: 0.0305, note: 'Rate is 3.05% for 2024+.' },
  KY: { name: 'Kentucky',    type: 'flat', flatRate: 0.04,   note: '4% flat (2024+, down from 4.5%).' },
  MA: { name: 'Massachusetts', type: 'flat', flatRate: 0.05, note: '9% surtax on income over ~$1M.' },
  MI: { name: 'Michigan',    type: 'flat', flatRate: 0.0425 },
  NC: { name: 'North Carolina', type: 'flat', flatRate: 0.045, note: 'Rate reduces to 3.99% by 2026.' },
  PA: { name: 'Pennsylvania', type: 'flat', flatRate: 0.0307 },
  UT: { name: 'Utah',        type: 'flat', flatRate: 0.0455 },

  // ─── Progressive states ────────────────────────────────────────────────────
  AL: {
    name: 'Alabama', type: 'brackets',
    brackets: {
      single: [
        { rate: 0.02, from: 0,      to: 500 },
        { rate: 0.04, from: 500,    to: 3000 },
        { rate: 0.05, from: 3000,   to: Infinity },
      ],
      joint: [
        { rate: 0.02, from: 0,      to: 1000 },
        { rate: 0.04, from: 1000,   to: 6000 },
        { rate: 0.05, from: 6000,   to: Infinity },
      ],
    },
    note: 'Alabama uses its own adjustments and deductions; this is an approximation.',
  },

  AR: {
    name: 'Arkansas', type: 'brackets',
    brackets: shared([
      { rate: 0.02, from: 0,       to: 5100 },
      { rate: 0.04, from: 5100,    to: 10300 },
      { rate: 0.044, from: 10300,  to: Infinity },
    ]),
    note: 'Arkansas is reducing to 3.9% for top bracket in 2025–2026.',
  },

  CA: {
    name: 'California', type: 'brackets',
    brackets: {
      single: [
        { rate: 0.01,   from: 0,       to: 10412 },
        { rate: 0.02,   from: 10412,   to: 24684 },
        { rate: 0.04,   from: 24684,   to: 38959 },
        { rate: 0.06,   from: 38959,   to: 54081 },
        { rate: 0.08,   from: 54081,   to: 68350 },
        { rate: 0.093,  from: 68350,   to: 349137 },
        { rate: 0.103,  from: 349137,  to: 418961 },
        { rate: 0.113,  from: 418961,  to: 698274 },
        { rate: 0.123,  from: 698274,  to: 1000000 },
        { rate: 0.133,  from: 1000000, to: Infinity },
      ],
      joint: [
        { rate: 0.01,   from: 0,       to: 20824 },
        { rate: 0.02,   from: 20824,   to: 49368 },
        { rate: 0.04,   from: 49368,   to: 77918 },
        { rate: 0.06,   from: 77918,   to: 108162 },
        { rate: 0.08,   from: 108162,  to: 136700 },
        { rate: 0.093,  from: 136700,  to: 698274 },
        { rate: 0.103,  from: 698274,  to: 837922 },
        { rate: 0.113,  from: 837922,  to: 1000000 },
        { rate: 0.123,  from: 1000000, to: 1396548 },
        { rate: 0.133,  from: 1396548, to: Infinity },
      ],
    },
    note: '1% SDI also applies. Rates are 2024 — 2026 brackets may be adjusted.',
  },

  CT: {
    name: 'Connecticut', type: 'brackets',
    brackets: {
      single: [
        { rate: 0.03,   from: 0,       to: 10000 },
        { rate: 0.05,   from: 10000,   to: 50000 },
        { rate: 0.055,  from: 50000,   to: 100000 },
        { rate: 0.06,   from: 100000,  to: 200000 },
        { rate: 0.065,  from: 200000,  to: 250000 },
        { rate: 0.069,  from: 250000,  to: 500000 },
        { rate: 0.0699, from: 500000,  to: Infinity },
      ],
      joint: [
        { rate: 0.03,   from: 0,       to: 20000 },
        { rate: 0.05,   from: 20000,   to: 100000 },
        { rate: 0.055,  from: 100000,  to: 200000 },
        { rate: 0.06,   from: 200000,  to: 400000 },
        { rate: 0.065,  from: 400000,  to: 500000 },
        { rate: 0.069,  from: 500000,  to: 1000000 },
        { rate: 0.0699, from: 1000000, to: Infinity },
      ],
    },
  },

  DC: {
    name: 'Washington DC', type: 'brackets',
    brackets: shared([
      { rate: 0.04,   from: 0,       to: 10000 },
      { rate: 0.06,   from: 10000,   to: 40000 },
      { rate: 0.065,  from: 40000,   to: 60000 },
      { rate: 0.085,  from: 60000,   to: 350000 },
      { rate: 0.0925, from: 350000,  to: 1000000 },
      { rate: 0.1075, from: 1000000, to: Infinity },
    ]),
  },

  DE: {
    name: 'Delaware', type: 'brackets',
    brackets: shared([
      { rate: 0,      from: 0,      to: 2000 },
      { rate: 0.022,  from: 2000,   to: 5000 },
      { rate: 0.039,  from: 5000,   to: 10000 },
      { rate: 0.048,  from: 10000,  to: 20000 },
      { rate: 0.052,  from: 20000,  to: 25000 },
      { rate: 0.0555, from: 25000,  to: 60000 },
      { rate: 0.066,  from: 60000,  to: Infinity },
    ]),
  },

  GA: {
    name: 'Georgia', type: 'flat', flatRate: 0.0549,
    note: 'Georgia transitioned to a 5.49% flat rate in 2024, reducing over time.',
  },

  HI: {
    name: 'Hawaii', type: 'brackets',
    brackets: {
      single: [
        { rate: 0.014, from: 0,       to: 2400 },
        { rate: 0.032, from: 2400,    to: 4800 },
        { rate: 0.055, from: 4800,    to: 9600 },
        { rate: 0.064, from: 9600,    to: 14400 },
        { rate: 0.068, from: 14400,   to: 19200 },
        { rate: 0.072, from: 19200,   to: 24000 },
        { rate: 0.076, from: 24000,   to: 36000 },
        { rate: 0.079, from: 36000,   to: 48000 },
        { rate: 0.0825, from: 48000,  to: 150000 },
        { rate: 0.09,  from: 150000,  to: 175000 },
        { rate: 0.10,  from: 175000,  to: 200000 },
        { rate: 0.11,  from: 200000,  to: Infinity },
      ],
      joint: [
        { rate: 0.014, from: 0,       to: 4800 },
        { rate: 0.032, from: 4800,    to: 9600 },
        { rate: 0.055, from: 9600,    to: 19200 },
        { rate: 0.064, from: 19200,   to: 28800 },
        { rate: 0.068, from: 28800,   to: 38400 },
        { rate: 0.072, from: 38400,   to: 48000 },
        { rate: 0.076, from: 48000,   to: 72000 },
        { rate: 0.079, from: 72000,   to: 96000 },
        { rate: 0.0825, from: 96000,  to: 300000 },
        { rate: 0.09,  from: 300000,  to: 350000 },
        { rate: 0.10,  from: 350000,  to: 400000 },
        { rate: 0.11,  from: 400000,  to: Infinity },
      ],
    },
  },

  IA: {
    name: 'Iowa', type: 'flat', flatRate: 0.038,
    note: 'Iowa phasing to 3.8% flat rate for 2025–2026.',
  },

  ID: {
    name: 'Idaho', type: 'flat', flatRate: 0.058,
    note: 'Idaho flat rate 5.8% as of 2023.',
  },

  KS: {
    name: 'Kansas', type: 'brackets',
    brackets: shared([
      { rate: 0.031, from: 0,       to: 15000 },
      { rate: 0.057, from: 15000,   to: 30000 },
      { rate: 0.057, from: 30000,   to: Infinity },
    ]),
    note: 'Kansas: 3.1% / 5.7% (2025 brackets may update).',
  },

  LA: {
    name: 'Louisiana', type: 'flat', flatRate: 0.03,
    note: 'Louisiana reduced to 3% flat rate as of 2025.',
  },

  ME: {
    name: 'Maine', type: 'brackets',
    brackets: {
      single: [
        { rate: 0.058, from: 0,       to: 26050 },
        { rate: 0.0675, from: 26050,  to: 61600 },
        { rate: 0.0715, from: 61600,  to: Infinity },
      ],
      joint: [
        { rate: 0.058, from: 0,       to: 52100 },
        { rate: 0.0675, from: 52100,  to: 123250 },
        { rate: 0.0715, from: 123250, to: Infinity },
      ],
    },
  },

  MD: {
    name: 'Maryland', type: 'brackets',
    brackets: {
      single: [
        { rate: 0.02,   from: 0,       to: 1000 },
        { rate: 0.03,   from: 1000,    to: 2000 },
        { rate: 0.04,   from: 2000,    to: 3000 },
        { rate: 0.0475, from: 3000,    to: 100000 },
        { rate: 0.05,   from: 100000,  to: 125000 },
        { rate: 0.0525, from: 125000,  to: 150000 },
        { rate: 0.055,  from: 150000,  to: 250000 },
        { rate: 0.0575, from: 250000,  to: Infinity },
      ],
      joint: [
        { rate: 0.02,   from: 0,       to: 1000 },
        { rate: 0.03,   from: 1000,    to: 2000 },
        { rate: 0.04,   from: 2000,    to: 3000 },
        { rate: 0.0475, from: 3000,    to: 150000 },
        { rate: 0.05,   from: 150000,  to: 175000 },
        { rate: 0.0525, from: 175000,  to: 225000 },
        { rate: 0.055,  from: 225000,  to: 300000 },
        { rate: 0.0575, from: 300000,  to: Infinity },
      ],
    },
    note: 'Maryland also has local county income taxes averaging ~3%.',
  },

  MN: {
    name: 'Minnesota', type: 'brackets',
    brackets: {
      single: [
        { rate: 0.0535, from: 0,       to: 32080 },
        { rate: 0.068,  from: 32080,   to: 105180 },
        { rate: 0.0785, from: 105180,  to: 175070 },
        { rate: 0.0985, from: 175070,  to: Infinity },
      ],
      joint: [
        { rate: 0.0535, from: 0,       to: 46330 },
        { rate: 0.068,  from: 46330,   to: 184040 },
        { rate: 0.0785, from: 184040,  to: 304970 },
        { rate: 0.0985, from: 304970,  to: Infinity },
      ],
    },
  },

  MO: {
    name: 'Missouri', type: 'flat', flatRate: 0.048,
    note: 'Missouri reduced to 4.8% flat rate for 2024.',
  },

  MS: {
    name: 'Mississippi', type: 'flat', flatRate: 0.047,
    note: 'Mississippi flat rate 4.7% for 2024, reducing toward 4% by 2026.',
  },

  MT: {
    name: 'Montana', type: 'flat', flatRate: 0.059,
    note: 'Montana reduced to 5.9% flat rate in 2024.',
  },

  NE: {
    name: 'Nebraska', type: 'brackets',
    brackets: {
      single: [
        { rate: 0.0246, from: 0,       to: 3700 },
        { rate: 0.0351, from: 3700,    to: 22170 },
        { rate: 0.0501, from: 22170,   to: 35730 },
        { rate: 0.0584, from: 35730,   to: Infinity },
      ],
      joint: [
        { rate: 0.0246, from: 0,       to: 7390 },
        { rate: 0.0351, from: 7390,    to: 44350 },
        { rate: 0.0501, from: 44350,   to: 71470 },
        { rate: 0.0584, from: 71470,   to: Infinity },
      ],
    },
  },

  NJ: {
    name: 'New Jersey', type: 'brackets',
    brackets: {
      single: [
        { rate: 0.014,  from: 0,       to: 20000 },
        { rate: 0.0175, from: 20000,   to: 35000 },
        { rate: 0.035,  from: 35000,   to: 40000 },
        { rate: 0.05525, from: 40000,  to: 75000 },
        { rate: 0.0637, from: 75000,   to: 500000 },
        { rate: 0.0897, from: 500000,  to: 1000000 },
        { rate: 0.1075, from: 1000000, to: Infinity },
      ],
      joint: [
        { rate: 0.014,  from: 0,       to: 20000 },
        { rate: 0.0175, from: 20000,   to: 50000 },
        { rate: 0.0245, from: 50000,   to: 70000 },
        { rate: 0.035,  from: 70000,   to: 80000 },
        { rate: 0.05525, from: 80000,  to: 150000 },
        { rate: 0.0637, from: 150000,  to: 500000 },
        { rate: 0.0897, from: 500000,  to: 1000000 },
        { rate: 0.1075, from: 1000000, to: Infinity },
      ],
    },
  },

  NM: {
    name: 'New Mexico', type: 'brackets',
    brackets: {
      single: [
        { rate: 0.017, from: 0,       to: 5500 },
        { rate: 0.032, from: 5500,    to: 11000 },
        { rate: 0.047, from: 11000,   to: 16000 },
        { rate: 0.049, from: 16000,   to: 210000 },
        { rate: 0.059, from: 210000,  to: Infinity },
      ],
      joint: [
        { rate: 0.017, from: 0,       to: 8000 },
        { rate: 0.032, from: 8000,    to: 16000 },
        { rate: 0.047, from: 16000,   to: 24000 },
        { rate: 0.049, from: 24000,   to: 315000 },
        { rate: 0.059, from: 315000,  to: Infinity },
      ],
    },
  },

  NY: {
    name: 'New York', type: 'brackets',
    brackets: {
      single: [
        { rate: 0.04,   from: 0,       to: 17150 },
        { rate: 0.045,  from: 17150,   to: 23600 },
        { rate: 0.0525, from: 23600,   to: 27900 },
        { rate: 0.0585, from: 27900,   to: 161550 },
        { rate: 0.0625, from: 161550,  to: 323200 },
        { rate: 0.0685, from: 323200,  to: 2155350 },
        { rate: 0.0965, from: 2155350, to: 5000000 },
        { rate: 0.103,  from: 5000000, to: 25000000 },
        { rate: 0.109,  from: 25000000, to: Infinity },
      ],
      joint: [
        { rate: 0.04,   from: 0,       to: 27900 },
        { rate: 0.045,  from: 27900,   to: 43000 },
        { rate: 0.0525, from: 43000,   to: 161550 },
        { rate: 0.0585, from: 161550,  to: 323200 },
        { rate: 0.0625, from: 323200,  to: 2155350 },
        { rate: 0.0685, from: 2155350, to: 5000000 },
        { rate: 0.0965, from: 5000000, to: 25000000 },
        { rate: 0.109,  from: 25000000, to: Infinity },
      ],
    },
    note: 'NYC also levies its own income tax of 3.08-3.876%.',
  },

  OH: {
    name: 'Ohio', type: 'brackets',
    brackets: shared([
      { rate: 0,      from: 0,       to: 26050 },
      { rate: 0.02765, from: 26050,  to: 100000 },
      { rate: 0.03226, from: 100000, to: 115300 },
      { rate: 0.03688, from: 115300, to: Infinity },
    ]),
    note: 'Ohio: no tax on first $26,050. School district taxes may apply.',
  },

  OK: {
    name: 'Oklahoma', type: 'brackets',
    brackets: {
      single: [
        { rate: 0.0025, from: 0,      to: 1000 },
        { rate: 0.0075, from: 1000,   to: 2500 },
        { rate: 0.0175, from: 2500,   to: 3750 },
        { rate: 0.0275, from: 3750,   to: 4900 },
        { rate: 0.0375, from: 4900,   to: 7200 },
        { rate: 0.0475, from: 7200,   to: Infinity },
      ],
      joint: [
        { rate: 0.0025, from: 0,      to: 2000 },
        { rate: 0.0075, from: 2000,   to: 5000 },
        { rate: 0.0175, from: 5000,   to: 7500 },
        { rate: 0.0275, from: 7500,   to: 9800 },
        { rate: 0.0375, from: 9800,   to: 12200 },
        { rate: 0.0475, from: 12200,  to: Infinity },
      ],
    },
  },

  OR: {
    name: 'Oregon', type: 'brackets',
    brackets: {
      single: [
        { rate: 0.0475, from: 0,       to: 4050 },
        { rate: 0.0675, from: 4050,    to: 10200 },
        { rate: 0.0875, from: 10200,   to: 125000 },
        { rate: 0.099,  from: 125000,  to: Infinity },
      ],
      joint: [
        { rate: 0.0475, from: 0,       to: 8100 },
        { rate: 0.0675, from: 8100,    to: 20400 },
        { rate: 0.0875, from: 20400,   to: 250000 },
        { rate: 0.099,  from: 250000,  to: Infinity },
      ],
    },
  },

  RI: {
    name: 'Rhode Island', type: 'brackets',
    brackets: shared([
      { rate: 0.0375, from: 0,       to: 77450 },
      { rate: 0.0475, from: 77450,   to: 176050 },
      { rate: 0.0599, from: 176050,  to: Infinity },
    ]),
  },

  SC: {
    name: 'South Carolina', type: 'flat', flatRate: 0.064,
    note: 'SC reduced top rate to 6.4% (2023) with further reductions planned.',
  },

  VA: {
    name: 'Virginia', type: 'brackets',
    brackets: shared([
      { rate: 0.02,  from: 0,     to: 3000 },
      { rate: 0.03,  from: 3000,  to: 5000 },
      { rate: 0.05,  from: 5000,  to: 17000 },
      { rate: 0.0575, from: 17000, to: Infinity },
    ]),
  },

  VT: {
    name: 'Vermont', type: 'brackets',
    brackets: {
      single: [
        { rate: 0.0335, from: 0,      to: 45400 },
        { rate: 0.066,  from: 45400,  to: 110050 },
        { rate: 0.076,  from: 110050, to: 229550 },
        { rate: 0.0875, from: 229550, to: Infinity },
      ],
      joint: [
        { rate: 0.0335, from: 0,      to: 75850 },
        { rate: 0.066,  from: 75850,  to: 183400 },
        { rate: 0.076,  from: 183400, to: 279450 },
        { rate: 0.0875, from: 279450, to: Infinity },
      ],
    },
  },

  WI: {
    name: 'Wisconsin', type: 'brackets',
    brackets: {
      single: [
        { rate: 0.035,  from: 0,      to: 14320 },
        { rate: 0.044,  from: 14320,  to: 28640 },
        { rate: 0.053,  from: 28640,  to: 315310 },
        { rate: 0.0765, from: 315310, to: Infinity },
      ],
      joint: [
        { rate: 0.035,  from: 0,      to: 19090 },
        { rate: 0.044,  from: 19090,  to: 38190 },
        { rate: 0.053,  from: 38190,  to: 420420 },
        { rate: 0.0765, from: 420420, to: Infinity },
      ],
    },
  },

  WV: {
    name: 'West Virginia', type: 'brackets',
    brackets: shared([
      { rate: 0.0236, from: 0,       to: 10000 },
      { rate: 0.0315, from: 10000,   to: 25000 },
      { rate: 0.0630, from: 25000,   to: 40000 },
      { rate: 0.0700, from: 40000,   to: 60000 },
      { rate: 0.0650, from: 60000,   to: Infinity },
    ]),
    note: 'WV reducing rates substantially 2024–2030.',
  },
};

// ─── Progressive tax helper ────────────────────────────────────────────────────

function calcProgressiveTax(taxableIncome: number, brackets: StateBracket[]): number {
  if (taxableIncome <= 0) return 0;
  let tax = 0;
  for (const bracket of brackets) {
    if (taxableIncome <= bracket.from) break;
    const taxable = Math.min(taxableIncome, bracket.to) - bracket.from;
    tax += taxable * bracket.rate;
  }
  return Math.max(0, tax);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface StateCalculationResult {
  tax: number | null;   // null = state not found / no-tax state returns 0
  effectiveRate: number | null;
  entryFound: boolean;
  isNoTaxState: boolean;
  note?: string;
}

/**
 * Compute estimated state income tax for a given state and federal taxable income.
 * Returns `null` for tax when the state is not in the table.
 */
export function calcStateTax(
  stateCode: string,
  federalTaxableIncome: number,
  filingStatus: FilingStatus,
): StateCalculationResult {
  const entry = STATE_TAX_RATES[stateCode.toUpperCase()];

  if (!entry) {
    return { tax: null, effectiveRate: null, entryFound: false, isNoTaxState: false };
  }

  if (entry.type === 'none') {
    return { tax: 0, effectiveRate: 0, entryFound: true, isNoTaxState: true, note: entry.note };
  }

  const isJoint = filingStatus === 'Married Filing Jointly';
  let tax = 0;

  if (entry.type === 'flat') {
    tax = federalTaxableIncome * (entry.flatRate ?? 0);
  } else if (entry.type === 'brackets' && entry.brackets) {
    const brackets =
      isJoint ? entry.brackets.joint :
      filingStatus === 'Head of Household' ? (entry.brackets.hoh ?? entry.brackets.single) :
      entry.brackets.single;
    tax = calcProgressiveTax(federalTaxableIncome, brackets);
  }

  const effectiveRate = federalTaxableIncome > 0 ? tax / federalTaxableIncome : 0;
  return { tax, effectiveRate, entryFound: true, isNoTaxState: false, note: entry.note };
}

/** Get the display name for a state code, or return the code itself. */
export function getStateName(stateCode: string): string {
  return STATE_TAX_RATES[stateCode.toUpperCase()]?.name ?? stateCode;
}

/** Check if a state has no income tax. */
export function isNoTaxState(stateCode: string): boolean {
  return STATE_TAX_RATES[stateCode.toUpperCase()]?.type === 'none';
}
