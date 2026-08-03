import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

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

  const latest = paystubs[paystubs.length - 1];
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
  const dti = monthlyNet > 0 ? (totalDebtMin / monthlyNet) * 100 : 0;
  const monthlyExpenses = totalBills + totalDebtMin;
  const emergencyMonths = monthlyExpenses > 0 ? Math.round((liquidCash / monthlyExpenses) * 10) / 10 : 0;

  // Health score (mirrors Dashboard.tsx)
  let healthScore = 0;
  if (monthlyNet > 0 && paystubs.length > 0) {
    let score = 0;
    const maxPts = 90;
    const ratio = freeCashFlow / monthlyNet;
    if (ratio >= 0.2) score += 20; else if (ratio > 0) score += Math.round((ratio / 0.2) * 20);
    const emM = monthlyExpenses > 0 ? liquidCash / monthlyExpenses : 0;
    if (emM >= 6) score += 20; else if (emM >= 3) score += 14; else if (emM >= 1) score += 7;
    const hiB = debts.filter(d => (d.interestRate ?? 0) > 10).reduce((s, d) => s + d.balance, 0);
    const util = Math.min(hiB / 10000, 1);
    if (util < 0.3) score += 15; else if (util < 0.6) score += 8;
    const dtiR = monthlyNet > 0 ? totalDebtMin / monthlyNet : 1;
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
  /** Record a batch of field-level changes and recompute metrics. */
  addChangeRecords: (records: FinancialChangeRecord[]) => void;
  /** Reverse all changes from a single import (identified by sourceDocumentId). */
  undoImport: (sourceDocumentId: string) => void;
  /** Restore a single field to its previous value. */
  restoreFieldValue: (changeId: string) => void;
  resetToDemo: () => void;
  clearAll: () => void;
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
    { id: 'd2', name: 'Credit Card (Tools)', balance: 3200, interestRate: 19.9, minimumPayment: 110 },
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
    { id: 'doc1', date: new Date().toISOString(), type: 'Paystub' as const, status: 'Pending Review' as const, data: { netPay: 1400, grossPay: 1900 } },
  ],
  changeHistory: [] as FinancialChangeRecord[],
};

const DEMO_STATE: StoreState = {
  ...DEMO_BASE,
  computed: computeMetrics(DEMO_BASE),
};

const DEFAULT_STATE: StoreState = {
  profile: null, paystubs: [], debts: [], bills: [], assets: [], documents: [],
  changeHistory: [], computed: EMPTY_METRICS,
};

// ─── Provider ─────────────────────────────────────────────────────────────────

const StoreContext = createContext<StoreContextType | null>(null);

/** Re-hydrate old stored state that may be missing newer fields. */
function migrateState(raw: any): StoreState {
  return {
    ...DEFAULT_STATE,
    ...raw,
    changeHistory: raw.changeHistory ?? [],
    computed: raw.computed ?? computeMetrics(raw),
    // Ensure arrays are always present
    paystubs: raw.paystubs ?? [],
    debts: raw.debts ?? [],
    bills: raw.bills ?? [],
    assets: raw.assets ?? [],
    documents: raw.documents ?? [],
  };
}

/** Apply an update to the mutable parts of state and recompute metrics. */
function withComputed(patch: Partial<StoreState>, prev: StoreState): StoreState {
  const next = { ...prev, ...patch };
  next.computed = computeMetrics(next);
  return next;
}

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

  const updateProfile = useCallback((profileUpdates: Partial<Profile>) => {
    setState(prev => withComputed({
      profile: prev.profile
        ? { ...prev.profile, ...profileUpdates }
        : { name: '', payFrequency: 'Weekly', hourlyRate: 0, filingContext: 'Single', hasCompletedOnboarding: false, ...profileUpdates } as Profile,
    }, prev));
  }, []);

  const addPaystub = useCallback((paystub: Omit<Paystub, 'id'>): string => {
    const id = crypto.randomUUID();
    setState(prev => withComputed({ paystubs: [...prev.paystubs, { ...paystub, id }] }, prev));
    return id;
  }, []);

  const removePaystub = useCallback((id: string) => {
    setState(prev => withComputed({ paystubs: prev.paystubs.filter(p => p.id !== id) }, prev));
  }, []);

  const addDebt = useCallback((debt: Omit<Debt, 'id'>): string => {
    const id = crypto.randomUUID();
    setState(prev => withComputed({ debts: [...prev.debts, { ...debt, id }] }, prev));
    return id;
  }, []);

  const removeDebt = useCallback((id: string) => {
    setState(prev => withComputed({ debts: prev.debts.filter(d => d.id !== id) }, prev));
  }, []);

  const updateDebt = useCallback((id: string, updates: Partial<Debt>) => {
    setState(prev => withComputed({
      debts: prev.debts.map(d => d.id === id ? { ...d, ...updates } : d),
    }, prev));
  }, []);

  const addBill = useCallback((bill: Omit<Bill, 'id'>): string => {
    const id = crypto.randomUUID();
    setState(prev => withComputed({ bills: [...prev.bills, { ...bill, id }] }, prev));
    return id;
  }, []);

  const removeBill = useCallback((id: string) => {
    setState(prev => withComputed({ bills: prev.bills.filter(b => b.id !== id) }, prev));
  }, []);

  const updateBill = useCallback((id: string, updates: Partial<Bill>) => {
    setState(prev => withComputed({
      bills: prev.bills.map(b => b.id === id ? { ...b, ...updates } : b),
    }, prev));
  }, []);

  const addAsset = useCallback((asset: Omit<Asset, 'id'>): string => {
    const id = crypto.randomUUID();
    setState(prev => withComputed({ assets: [...prev.assets, { ...asset, id }] }, prev));
    return id;
  }, []);

  const removeAsset = useCallback((id: string) => {
    setState(prev => withComputed({ assets: prev.assets.filter(a => a.id !== id) }, prev));
  }, []);

  const updateAsset = useCallback((id: string, updates: Partial<Asset>) => {
    setState(prev => withComputed({
      assets: prev.assets.map(a => a.id === id ? { ...a, ...updates } : a),
    }, prev));
  }, []);

  const addDocument = useCallback((doc: Omit<ScannedDocument, 'id' | 'date'>) => {
    setState(prev => ({
      ...prev,
      documents: [...prev.documents, { ...doc, date: new Date().toISOString(), id: crypto.randomUUID() }],
    }));
  }, []);

  const updateDocument = useCallback((id: string, updates: Partial<ScannedDocument>) => {
    setState(prev => ({
      ...prev,
      documents: prev.documents.map(d => d.id === id ? { ...d, ...updates } : d),
    }));
  }, []);

  const removeDocument = useCallback((id: string) => {
    setState(prev => ({ ...prev, documents: prev.documents.filter(d => d.id !== id) }));
  }, []);

  const addChangeRecords = useCallback((records: FinancialChangeRecord[]) => {
    if (records.length === 0) return;
    setState(prev => ({
      ...prev,
      changeHistory: [...prev.changeHistory, ...records],
      // metrics already current since the underlying add/update calls already ran withComputed
    }));
  }, []);

  const undoImport = useCallback((sourceDocumentId: string) => {
    setState(prev => {
      const toUndo = prev.changeHistory.filter(r => r.sourceDocumentId === sourceDocumentId);
      if (toUndo.length === 0) return prev;

      let assets = [...prev.assets];
      let debts = [...prev.debts];
      let bills = [...prev.bills];
      let paystubs = [...prev.paystubs];

      // Process in reverse so we undo later changes first
      for (const rec of [...toUndo].reverse()) {
        if (rec.field === 'created') {
          // Delete the record that was created
          if (rec.destinationSection === 'assets') assets = assets.filter(a => a.id !== rec.recordId);
          else if (rec.destinationSection === 'debts') debts = debts.filter(d => d.id !== rec.recordId);
          else if (rec.destinationSection === 'bills') bills = bills.filter(b => b.id !== rec.recordId);
          else if (rec.destinationSection === 'paystubs') paystubs = paystubs.filter(p => p.id !== rec.recordId);
        } else if (rec.oldValue !== null && rec.oldValue !== undefined) {
          // Only restore fields where we have a meaningful previous value
          if (rec.destinationSection === 'assets')
            assets = assets.map(a => a.id === rec.recordId ? { ...a, [rec.field]: rec.oldValue } : a);
          else if (rec.destinationSection === 'debts')
            debts = debts.map(d => d.id === rec.recordId ? { ...d, [rec.field]: rec.oldValue } : d);
          else if (rec.destinationSection === 'bills')
            bills = bills.map(b => b.id === rec.recordId ? { ...b, [rec.field]: rec.oldValue } : b);
        }
      }

      const changeHistory = prev.changeHistory.filter(r => r.sourceDocumentId !== sourceDocumentId);
      return withComputed({ assets, debts, bills, paystubs, changeHistory }, prev);
    });
  }, []);

  const restoreFieldValue = useCallback((changeId: string) => {
    setState(prev => {
      const rec = prev.changeHistory.find(r => r.id === changeId);
      // Skip: no record, creation records, or records with no meaningful old value
      if (!rec || rec.field === 'created' || rec.oldValue === null || rec.oldValue === undefined) return prev;

      let assets = prev.assets;
      let debts = prev.debts;
      let bills = prev.bills;

      if (rec.destinationSection === 'assets')
        assets = assets.map(a => a.id === rec.recordId ? { ...a, [rec.field]: rec.oldValue } : a);
      else if (rec.destinationSection === 'debts')
        debts = debts.map(d => d.id === rec.recordId ? { ...d, [rec.field]: rec.oldValue } : d);
      else if (rec.destinationSection === 'bills')
        bills = bills.map(b => b.id === rec.recordId ? { ...b, [rec.field]: rec.oldValue } : b);

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
