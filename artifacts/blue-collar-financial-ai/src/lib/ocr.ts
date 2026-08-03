import Tesseract from 'tesseract.js';

export type Confidence = 'high' | 'medium' | 'low';

export interface ExtractedField<T> {
  value: T;
  confidence: Confidence;
  found: boolean;
}

function field<T>(value: T, confidence: Confidence, found = true): ExtractedField<T> {
  return { value, confidence, found };
}

function notFound<T>(fallback: T): ExtractedField<T> {
  return { value: fallback, confidence: 'low', found: false };
}

// ─── Regex helpers ────────────────────────────────────────────────────────────

function findDollar(text: string, patterns: RegExp[]): { value: number; confidence: Confidence } | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const raw = m[1].replace(/[$,]/g, '');
      const n = parseFloat(raw);
      if (!isNaN(n) && n > 0) return { value: n, confidence: 'high' };
    }
  }
  return null;
}

function findNumber(text: string, patterns: RegExp[]): { value: number; confidence: Confidence } | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const n = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(n)) return { value: n, confidence: 'high' };
    }
  }
  return null;
}

function findText(text: string, patterns: RegExp[]): { value: string; confidence: Confidence } | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]?.trim()) return { value: m[1].trim(), confidence: 'high' };
  }
  return null;
}

// ─── Paystub extraction ───────────────────────────────────────────────────────

export interface ExtractedPaystub {
  employer: ExtractedField<string>;
  date: ExtractedField<string>;
  hourlyRate: ExtractedField<number>;
  regularHours: ExtractedField<number>;
  overtimeHours: ExtractedField<number>;
  doubleTimeHours: ExtractedField<number>;
  perDiem: ExtractedField<number>;
  grossPay: ExtractedField<number>;
  taxes: ExtractedField<number>;
  deductions: ExtractedField<number>;
  netPay: ExtractedField<number>;
}

function extractPaystub(text: string): ExtractedPaystub | null {
  const t = text.replace(/\s+/g, ' ');
  const isPaystub = /pay\s*stub|earnings\s*statement|pay\s*period|pay\s*date|net\s*pay|gross\s*(?:pay|earnings)/i.test(t);
  if (!isPaystub) return null;

  const hourlyRate = findDollar(t, [
    /hourly\s*rate[:\s#]*\$?([\d,]+\.?\d{0,2})/i,
    /rate\s*of\s*pay[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /base\s*(?:hourly\s*)?rate[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /\$?([\d,]+\.?\d{0,2})\s*(?:\/\s*hr|per\s+hour)/i,
    /rate[:\s]+\$?([\d,]+\.?\d{0,2})/i,
  ]);

  const regularHours = findNumber(t, [
    /regular\s*(?:hours?|hrs?)[:\s]*([\d.]+)/i,
    /reg\s*(?:hours?|hrs?)[:\s]*([\d.]+)/i,
    /straight\s*time\s*(?:hours?|hrs?)[:\s]*([\d.]+)/i,
  ]);

  const overtimeHours = findNumber(t, [
    /over\s*time\s*(?:hours?|hrs?)[:\s]*([\d.]+)/i,
    /o\.?t\.?\s*(?:hours?|hrs?)[:\s]*([\d.]+)/i,
    /overtime[:\s]*([\d.]+)\s*(?:hours?|hrs?)/i,
  ]);

  const doubleTimeHours = findNumber(t, [
    /double\s*time\s*(?:hours?|hrs?)[:\s]*([\d.]+)/i,
    /d\.?t\.?\s*(?:hours?|hrs?)[:\s]*([\d.]+)/i,
  ]);

  const perDiem = findDollar(t, [
    /per\s*diem[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /allowance[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /subsistence[:\s]*\$?([\d,]+\.?\d{0,2})/i,
  ]);

  const grossPay = findDollar(t, [
    /gross\s*(?:pay|earnings|wages?)[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /total\s*(?:gross|earnings)[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /current\s*gross[:\s]*\$?([\d,]+\.?\d{0,2})/i,
  ]);

  const netPay = findDollar(t, [
    /net\s*(?:pay|wages?|amount)[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /take[\s-]*home\s*(?:pay)?[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /check\s*amount[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /net\s*this\s*period[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /direct\s*deposit[:\s]*\$?([\d,]+\.?\d{0,2})/i,
  ]);

  const taxes = findDollar(t, [
    /(?:total\s*)?(?:federal|state|local)?\s*tax(?:es)?[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /withholding[s]?[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /income\s*tax[:\s]*\$?([\d,]+\.?\d{0,2})/i,
  ]);

  const deductions = findDollar(t, [
    /total\s*deductions?[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /(?:pre|post)[\s-]*tax\s*deductions?[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /deductions?[:\s]*\$?([\d,]+\.?\d{0,2})/i,
  ]);

  const employer = findText(t, [
    /(?:employer|company|organization)[:\s]+([A-Z][A-Za-z0-9\s&.,'-]{2,40})/i,
    /pay\s*stub\s+(?:for\s+)?([A-Z][A-Za-z0-9\s&.,'-]{2,40})\s/i,
  ]);

  const dateMatch = t.match(/(?:pay\s*date|period\s*end(?:ing)?|check\s*date)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i)
    || t.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/);

  return {
    employer: employer ? field(employer.value, 'high') : notFound(''),
    date: dateMatch ? field(dateMatch[1], 'high') : notFound(new Date().toISOString().split('T')[0]),
    hourlyRate: hourlyRate ? field(hourlyRate.value, 'high') : notFound(0),
    regularHours: regularHours ? field(regularHours.value, 'high') : notFound(40),
    overtimeHours: overtimeHours ? field(overtimeHours.value, 'high') : notFound(0),
    doubleTimeHours: doubleTimeHours ? field(doubleTimeHours.value, 'high') : notFound(0),
    perDiem: perDiem ? field(perDiem.value, 'high') : notFound(0),
    grossPay: grossPay ? field(grossPay.value, 'high') : notFound(0),
    taxes: taxes ? field(taxes.value, taxes.confidence) : notFound(0),
    deductions: deductions ? field(deductions.value, deductions.confidence) : notFound(0),
    netPay: netPay ? field(netPay.value, 'high') : notFound(0),
  };
}

// ─── Bank account extraction ──────────────────────────────────────────────────

export interface ExtractedBankAccount {
  name: ExtractedField<string>;
  balance: ExtractedField<number>;
}

function extractBankAccounts(text: string): ExtractedBankAccount[] {
  const t = text.replace(/\s+/g, ' ');
  const isBanking = /(?:checking|savings|account\s*balance|available\s*balance|bank|credit\s*union)/i.test(t);
  if (!isBanking) return [];

  const accounts: ExtractedBankAccount[] = [];

  // Look for labeled account+balance pairs
  const patterns = [
    { nameRe: /checking[:\s]*account/i, balanceRe: /checking[:\s]*(?:account)?[:\s]*\$?([\d,]+\.?\d{0,2})/i, label: 'Checking' },
    { nameRe: /savings[:\s]*account/i, balanceRe: /savings[:\s]*(?:account)?[:\s]*\$?([\d,]+\.?\d{0,2})/i, label: 'Savings' },
    { nameRe: /money\s*market/i, balanceRe: /money\s*market[:\s]*\$?([\d,]+\.?\d{0,2})/i, label: 'Money Market' },
  ];

  for (const p of patterns) {
    if (p.nameRe.test(t)) {
      const balanceM = findDollar(t, [p.balanceRe, /available\s*balance[:\s]*\$?([\d,]+\.?\d{0,2})/i, /(?:current|account)\s*balance[:\s]*\$?([\d,]+\.?\d{0,2})/i]);
      if (balanceM) {
        accounts.push({
          name: field(p.label, 'high'),
          balance: field(balanceM.value, 'high'),
        });
      }
    }
  }

  // Fallback: generic balance
  if (accounts.length === 0) {
    const balance = findDollar(t, [
      /available\s*balance[:\s]*\$?([\d,]+\.?\d{0,2})/i,
      /(?:current|account)\s*balance[:\s]*\$?([\d,]+\.?\d{0,2})/i,
      /total\s*balance[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    ]);
    if (balance) {
      const acctName = /checking/i.test(t) ? 'Checking' : /savings/i.test(t) ? 'Savings' : 'Account';
      accounts.push({ name: field(acctName, 'medium'), balance: field(balance.value, 'high') });
    }
  }

  return accounts;
}

// ─── Credit card extraction ───────────────────────────────────────────────────

export interface ExtractedCreditCard {
  name: ExtractedField<string>;
  balance: ExtractedField<number>;
  limit: ExtractedField<number>;
  apr: ExtractedField<number>;
  minimumPayment: ExtractedField<number>;
}

function extractCreditCards(text: string): ExtractedCreditCard[] {
  const t = text.replace(/\s+/g, ' ');
  const isCreditCard = /credit\s*card|(?:visa|mastercard|amex|discover|capital\s*one|chase\s*sapphire)|statement\s*balance|minimum\s*(?:payment|due)/i.test(t);
  if (!isCreditCard) return [];

  const nameMatch = findText(t, [
    /(?:card\s*name|account\s*name|card)[:\s]+([A-Z][A-Za-z0-9\s®™&.,'-]{2,30}(?:card)?)/i,
    /((?:Visa|Mastercard|Amex|Discover|Sapphire|Freedom|Quicksilver|Venture|Platinum|Gold|Blue\s*Cash)[A-Za-z\s®™]*)/i,
  ]);

  const balance = findDollar(t, [
    /(?:statement|current|new)\s*balance[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /amount\s*(?:owed|due)[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /balance[:\s]*\$?([\d,]+\.?\d{0,2})/i,
  ]);

  const limit = findDollar(t, [
    /credit\s*(?:limit|line)[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /(?:total\s*)?credit\s*available[:\s]*\$?([\d,]+\.?\d{0,2})/i,
  ]);

  const apr = findNumber(t, [
    /(?:purchase\s*)?apr[:\s]*([\d.]+)%?/i,
    /annual\s*percentage\s*rate[:\s]*([\d.]+)%?/i,
    /interest\s*rate[:\s]*([\d.]+)%?/i,
    /([\d.]+)%\s*(?:var(?:iable)?)?\s*APR/i,
  ]);

  const minPayment = findDollar(t, [
    /minimum\s*(?:payment|amount\s*due)[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /min(?:imum)?\s*due[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /minimum\s*payment\s*due[:\s]*\$?([\d,]+\.?\d{0,2})/i,
  ]);

  if (!balance && !limit) return [];

  return [{
    name: nameMatch ? field(nameMatch.value, 'high') : field('Credit Card', 'low'),
    balance: balance ? field(balance.value, 'high') : notFound(0),
    limit: limit ? field(limit.value, 'high') : notFound(0),
    apr: apr ? field(apr.value, 'high') : notFound(0),
    minimumPayment: minPayment ? field(minPayment.value, 'high') : notFound(0),
  }];
}

// ─── Loan extraction ──────────────────────────────────────────────────────────

export interface ExtractedLoan {
  name: ExtractedField<string>;
  balance: ExtractedField<number>;
  apr: ExtractedField<number>;
  monthlyPayment: ExtractedField<number>;
}

function extractLoans(text: string): ExtractedLoan[] {
  const t = text.replace(/\s+/g, ' ');
  const isLoan = /(?:loan|mortgage|auto\s*(?:loan|finance)|student\s*loan|personal\s*loan|principal|payoff\s*amount)/i.test(t);
  if (!isLoan) return [];

  const loanType = /mortgage|home\s*loan/i.test(t) ? 'Mortgage'
    : /auto|vehicle|car\s*loan/i.test(t) ? 'Auto Loan'
    : /student/i.test(t) ? 'Student Loan'
    : 'Personal Loan';

  const balance = findDollar(t, [
    /(?:outstanding|remaining|current|payoff)\s*(?:principal\s*)?balance[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /principal\s*balance[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /amount\s*(?:financed|owed)[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /balance[:\s]*\$?([\d,]+\.?\d{0,2})/i,
  ]);

  const apr = findNumber(t, [
    /(?:interest\s*rate|apr)[:\s]*([\d.]+)%?/i,
    /annual\s*percentage\s*rate[:\s]*([\d.]+)%?/i,
    /([\d.]+)%\s*(?:per\s*(?:year|annum)|APR)/i,
  ]);

  const monthlyPayment = findDollar(t, [
    /(?:monthly|regular|scheduled)\s*(?:payment|installment)[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /payment\s*amount[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /amount\s*due[:\s]*\$?([\d,]+\.?\d{0,2})/i,
  ]);

  if (!balance) return [];

  return [{
    name: field(loanType, 'medium'),
    balance: field(balance.value, 'high'),
    apr: apr ? field(apr.value, 'high') : notFound(0),
    monthlyPayment: monthlyPayment ? field(monthlyPayment.value, 'high') : notFound(0),
  }];
}

// ─── Investment extraction ────────────────────────────────────────────────────

export interface ExtractedInvestment {
  name: ExtractedField<string>;
  value: ExtractedField<number>;
}

function extractInvestments(text: string): ExtractedInvestment[] {
  const t = text.replace(/\s+/g, ' ');
  const isInvestment = /(?:401\(k\)|401k|ira|brokerage|investment|roth|portfolio|vanguard|fidelity|schwab|e[\s-]*trade|retirement)/i.test(t);
  if (!isInvestment) return [];

  const acctType = /401[\s(]*k/i.test(t) ? '401(k)'
    : /roth\s*ira/i.test(t) ? 'Roth IRA'
    : /traditional\s*ira|ira/i.test(t) ? 'IRA'
    : /brokerage/i.test(t) ? 'Brokerage'
    : 'Investment Account';

  const value = findDollar(t, [
    /(?:total|portfolio|account|current)\s*(?:value|balance)[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /(?:vested|market)\s*(?:value|balance)[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /(?:total\s*)?assets?[:\s]*\$?([\d,]+\.?\d{0,2})/i,
    /balance[:\s]*\$?([\d,]+\.?\d{0,2})/i,
  ]);

  if (!value) return [];

  return [{
    name: field(acctType, 'medium'),
    value: field(value.value, 'high'),
  }];
}

// ─── Main extraction ──────────────────────────────────────────────────────────

export interface ScanResult {
  paystub: ExtractedPaystub | null;
  bankAccounts: ExtractedBankAccount[];
  creditCards: ExtractedCreditCard[];
  loans: ExtractedLoan[];
  investments: ExtractedInvestment[];
  rawText: string;
}

export function extractFromText(combinedText: string): ScanResult {
  // Split text by potential document boundaries (long whitespace runs)
  const chunks = combinedText.split(/\n{3,}|\f/).filter(c => c.trim().length > 20);

  let paystub: ExtractedPaystub | null = null;
  const bankAccounts: ExtractedBankAccount[] = [];
  const creditCards: ExtractedCreditCard[] = [];
  const loans: ExtractedLoan[] = [];
  const investments: ExtractedInvestment[] = [];

  // Try each chunk as a separate document
  for (const chunk of chunks) {
    if (!paystub) {
      paystub = extractPaystub(chunk);
    }
    bankAccounts.push(...extractBankAccounts(chunk));
    creditCards.push(...extractCreditCards(chunk));
    loans.push(...extractLoans(chunk));
    investments.push(...extractInvestments(chunk));
  }

  // Also try the full combined text
  if (!paystub) paystub = extractPaystub(combinedText);
  if (bankAccounts.length === 0) bankAccounts.push(...extractBankAccounts(combinedText));
  if (creditCards.length === 0) creditCards.push(...extractCreditCards(combinedText));
  if (loans.length === 0) loans.push(...extractLoans(combinedText));
  if (investments.length === 0) investments.push(...extractInvestments(combinedText));

  return { paystub, bankAccounts, creditCards, loans, investments, rawText: combinedText };
}

// ─── OCR Runner ───────────────────────────────────────────────────────────────

export interface OcrFileResult {
  fileName: string;
  text: string;
  error?: string;
}

export async function runOcrOnFiles(
  files: File[],
  onProgress: (fileIndex: number, progress: number) => void
): Promise<OcrFileResult[]> {
  const results: OcrFileResult[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const result = await Tesseract.recognize(file, 'eng', {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === 'recognizing text') {
            onProgress(i, Math.round(m.progress * 100));
          }
        },
      });
      onProgress(i, 100);
      results.push({ fileName: file.name, text: result.data.text });
    } catch (err) {
      results.push({ fileName: file.name, text: '', error: String(err) });
    }
  }

  return results;
}
