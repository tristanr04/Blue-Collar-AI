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
}

export interface Bill {
  id: string;
  name: string;
  amount: number;
  dueDate: number; // Day of month (1-31)
  isAutoPay: boolean;
}

export interface Asset {
  id: string;
  name: string;
  type: 'Cash' | 'Investment' | 'Other';
  value: number;
}

export interface ScannedDocument {
  id: string;
  date: string;
  type: 'Paystub' | 'Bill' | 'Other';
  status: 'Pending Review' | 'Processed' | 'Rejected';
  data?: any;
}

interface StoreState {
  profile: Profile | null;
  paystubs: Paystub[];
  debts: Debt[];
  bills: Bill[];
  assets: Asset[];
  documents: ScannedDocument[];
}

interface StoreContextType extends StoreState {
  updateProfile: (profile: Partial<Profile>) => void;
  addPaystub: (paystub: Omit<Paystub, 'id'>) => void;
  removePaystub: (id: string) => void;
  addDebt: (debt: Omit<Debt, 'id'>) => void;
  removeDebt: (id: string) => void;
  addBill: (bill: Omit<Bill, 'id'>) => void;
  removeBill: (id: string) => void;
  addAsset: (asset: Omit<Asset, 'id'>) => void;
  removeAsset: (id: string) => void;
  addDocument: (doc: Omit<ScannedDocument, 'id' | 'date'>) => void;
  updateDocument: (id: string, updates: Partial<ScannedDocument>) => void;
  removeDocument: (id: string) => void;
  resetToDemo: () => void;
  clearAll: () => void;
}

const DEMO_STATE: StoreState = {
  profile: {
    name: 'Mike',
    payFrequency: 'Weekly',
    hourlyRate: 35.50,
    filingContext: 'Married',
    hasCompletedOnboarding: true,
  },
  paystubs: [
    {
      id: 'p1',
      date: new Date().toISOString(),
      employer: 'United Construction',
      regularHours: 40,
      overtimeHours: 8,
      doubleTimeHours: 0,
      perDiem: 150,
      grossPay: 1854,
      taxes: 350,
      deductions: 120,
      netPay: 1384,
    }
  ],
  debts: [
    { id: 'd1', name: 'F-150 Auto Loan', balance: 24500, interestRate: 5.5, minimumPayment: 480 },
    { id: 'd2', name: 'Credit Card (Tools)', balance: 3200, interestRate: 19.9, minimumPayment: 110 }
  ],
  bills: [
    { id: 'b1', name: 'Rent', amount: 1600, dueDate: 1, isAutoPay: true },
    { id: 'b2', name: 'Phone', amount: 95, dueDate: 15, isAutoPay: true },
    { id: 'b3', name: 'Insurance', amount: 145, dueDate: 20, isAutoPay: false }
  ],
  assets: [
    { id: 'a1', name: 'Checking', type: 'Cash', value: 2450 },
    { id: 'a2', name: 'Emergency Fund', type: 'Cash', value: 5000 },
    { id: 'a3', name: 'Union 401k', type: 'Investment', value: 14500 }
  ],
  documents: [
    { id: 'doc1', date: new Date().toISOString(), type: 'Paystub', status: 'Pending Review', data: { netPay: 1400, grossPay: 1900 } }
  ]
};

const DEFAULT_STATE: StoreState = {
  profile: null,
  paystubs: [],
  debts: [],
  bills: [],
  assets: [],
  documents: [],
};

const StoreContext = createContext<StoreContextType | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<StoreState>(() => {
    try {
      const stored = localStorage.getItem('bcf_state');
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.error('Failed to parse state', e);
    }
    return DEFAULT_STATE;
  });

  useEffect(() => {
    localStorage.setItem('bcf_state', JSON.stringify(state));
  }, [state]);

  const updateProfile = useCallback((profileUpdates: Partial<Profile>) => {
    setState(prev => ({
      ...prev,
      profile: prev.profile ? { ...prev.profile, ...profileUpdates } : { 
        name: '', 
        payFrequency: 'Weekly', 
        hourlyRate: 0, 
        filingContext: 'Single', 
        hasCompletedOnboarding: false,
        ...profileUpdates 
      } as Profile
    }));
  }, []);

  const addPaystub = useCallback((paystub: Omit<Paystub, 'id'>) => {
    setState(prev => ({ ...prev, paystubs: [...prev.paystubs, { ...paystub, id: crypto.randomUUID() }] }));
  }, []);

  const removePaystub = useCallback((id: string) => {
    setState(prev => ({ ...prev, paystubs: prev.paystubs.filter(p => p.id !== id) }));
  }, []);

  const addDebt = useCallback((debt: Omit<Debt, 'id'>) => {
    setState(prev => ({ ...prev, debts: [...prev.debts, { ...debt, id: crypto.randomUUID() }] }));
  }, []);

  const removeDebt = useCallback((id: string) => {
    setState(prev => ({ ...prev, debts: prev.debts.filter(d => d.id !== id) }));
  }, []);

  const addBill = useCallback((bill: Omit<Bill, 'id'>) => {
    setState(prev => ({ ...prev, bills: [...prev.bills, { ...bill, id: crypto.randomUUID() }] }));
  }, []);

  const removeBill = useCallback((id: string) => {
    setState(prev => ({ ...prev, bills: prev.bills.filter(b => b.id !== id) }));
  }, []);

  const addAsset = useCallback((asset: Omit<Asset, 'id'>) => {
    setState(prev => ({ ...prev, assets: [...prev.assets, { ...asset, id: crypto.randomUUID() }] }));
  }, []);

  const removeAsset = useCallback((id: string) => {
    setState(prev => ({ ...prev, assets: prev.assets.filter(a => a.id !== id) }));
  }, []);

  const addDocument = useCallback((doc: Omit<ScannedDocument, 'id' | 'date'>) => {
    setState(prev => ({ 
      ...prev, 
      documents: [...prev.documents, { ...doc, date: new Date().toISOString(), id: crypto.randomUUID() }] 
    }));
  }, []);

  const updateDocument = useCallback((id: string, updates: Partial<ScannedDocument>) => {
    setState(prev => ({
      ...prev,
      documents: prev.documents.map(d => d.id === id ? { ...d, ...updates } : d)
    }));
  }, []);

  const removeDocument = useCallback((id: string) => {
    setState(prev => ({ ...prev, documents: prev.documents.filter(d => d.id !== id) }));
  }, []);

  const resetToDemo = useCallback(() => setState(DEMO_STATE), []);
  const clearAll = useCallback(() => setState(DEFAULT_STATE), []);

  return (
    <StoreContext.Provider value={{
      ...state,
      updateProfile,
      addPaystub, removePaystub,
      addDebt, removeDebt,
      addBill, removeBill,
      addAsset, removeAsset,
      addDocument, updateDocument, removeDocument,
      resetToDemo, clearAll
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
