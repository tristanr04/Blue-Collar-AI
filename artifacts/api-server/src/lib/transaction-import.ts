import crypto from "node:crypto";

export type TransactionCategory =
  | "income" | "housing" | "utilities" | "groceries" | "dining" | "fuel"
  | "transportation" | "insurance" | "healthcare" | "shopping" | "entertainment"
  | "subscriptions" | "travel" | "debt_payment" | "transfer" | "fees"
  | "taxes" | "cash" | "other";

export type ImportedTransaction = {
  id: string;
  source: "csv" | "statement" | "screenshot" | "manual";
  sourceFile?: string;
  accountLastFour?: string | null;
  postedDate: string;
  descriptionRaw: string;
  merchant: string;
  amount: number;
  direction: "debit" | "credit";
  category: TransactionCategory;
  categoryConfidence: number;
  recurring: boolean;
  excludedFromSpending: boolean;
  exclusionReason?: "transfer" | "credit_card_payment" | "refund" | "income";
  fingerprint: string;
  needsReview: boolean;
};

export type MerchantRule = {
  merchantPattern: string;
  category: TransactionCategory;
  excludeFromSpending?: boolean;
};

const HEADER_ALIASES = {
  date: ["date", "posted date", "posting date", "transaction date", "trans date"],
  description: ["description", "merchant", "name", "details", "memo", "transaction"],
  amount: ["amount", "transaction amount"],
  debit: ["debit", "withdrawal", "charge"],
  credit: ["credit", "deposit", "payment"],
} as const;

const CATEGORY_PATTERNS: Array<[TransactionCategory, RegExp]> = [
  ["transfer", /\b(transfer|xfer|zelle|venmo transfer|cash app transfer|ach transfer)\b/i],
  ["debt_payment", /\b(payment thank you|credit card payment|card payment|loan payment|autopay payment)\b/i],
  ["income", /\b(payroll|direct deposit|salary|paycheck|wages|employer deposit)\b/i],
  ["refund", /\b(refund|reversal|returned purchase|merchant credit)\b/i] as never,
  ["housing", /\b(rent|mortgage|property management|hoa)\b/i],
  ["utilities", /\b(electric|energy|water|gas utility|internet|broadband|wireless|phone|sewer)\b/i],
  ["groceries", /\b(walmart grocery|kroger|aldi|costco|sam'?s club|whole foods|grocery|market)\b/i],
  ["dining", /\b(doordash|uber eats|grubhub|restaurant|cafe|coffee|mcdonald|taco bell|chick-fil-a|starbucks)\b/i],
  ["fuel", /\b(quiktrip|qt |shell|exxon|chevron|bp |fuel|gas station|circle k|casey'?s)\b/i],
  ["transportation", /\b(uber|lyft|parking|toll|transit|auto repair|tires|oil change)\b/i],
  ["insurance", /\b(insurance|geico|progressive|state farm|allstate|liberty mutual)\b/i],
  ["healthcare", /\b(pharmacy|cvs|walgreens|hospital|clinic|medical|dental|vision)\b/i],
  ["subscriptions", /\b(netflix|hulu|spotify|apple\.com\/bill|youtube premium|membership|subscription)\b/i],
  ["entertainment", /\b(cinema|theatre|steam|playstation|xbox|gaming|concert|ticketmaster)\b/i],
  ["travel", /\b(hotel|airbnb|airlines|flight|expedia|booking\.com|rental car)\b/i],
  ["shopping", /\b(amazon|target|best buy|home depot|lowe'?s|ebay|etsy|shop|store)\b/i],
  ["fees", /\b(overdraft|service fee|maintenance fee|atm fee|late fee)\b/i],
  ["taxes", /\b(irs|tax payment|ok tax commission|revenue service)\b/i],
  ["cash", /\b(atm withdrawal|cash withdrawal)\b/i],
];

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(cell.trim()); cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && input[i + 1] === "\n") i += 1;
      row.push(cell.trim()); cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function findColumn(headers: string[], aliases: readonly string[]): number {
  return headers.findIndex(header => aliases.includes(header));
}

function parseMoney(raw: string): number | null {
  if (!raw?.trim()) return null;
  const negative = /^\s*\(/.test(raw) || /-\s*$/.test(raw) || /^\s*-/.test(raw);
  const numeric = Number(raw.replace(/[$,()]/g, "").replace(/\s+/g, "").replace(/-$/, ""));
  if (!Number.isFinite(numeric)) return null;
  return negative ? -Math.abs(numeric) : numeric;
}

function toIsoDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
  if (!match) return null;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const month = Number(match[1]);
  const day = Number(match[2]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

export function normalizeMerchant(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\b(POS|DEBIT|PURCHASE|CHECKCARD|ACH|ONLINE|RECURRING)\b/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/[#*]\w+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function categorize(description: string, direction: "debit" | "credit", rules: MerchantRule[]) {
  const custom = rules.find(rule => new RegExp(rule.merchantPattern, "i").test(description));
  if (custom) return { category: custom.category, confidence: 98, excluded: Boolean(custom.excludeFromSpending) };
  if (direction === "credit" && /refund|reversal|returned purchase|merchant credit/i.test(description)) {
    return { category: "shopping" as TransactionCategory, confidence: 90, excluded: true, reason: "refund" as const };
  }
  for (const [category, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(description)) {
      const excluded = category === "transfer" || category === "debt_payment" || category === "income";
      const reason = category === "transfer" ? "transfer" : category === "debt_payment" ? "credit_card_payment" : category === "income" ? "income" : undefined;
      return { category, confidence: 88, excluded, reason };
    }
  }
  return { category: "other" as TransactionCategory, confidence: 35, excluded: false };
}

function fingerprintOf(date: string, amount: number, merchant: string, accountLastFour?: string | null): string {
  return crypto.createHash("sha256").update([date, amount.toFixed(2), merchant, accountLastFour ?? ""].join("|")).digest("hex");
}

export function importCsvTransactions(args: {
  csv: string;
  sourceFile?: string;
  accountLastFour?: string | null;
  merchantRules?: MerchantRule[];
  existingFingerprints?: string[];
}): { transactions: ImportedTransaction[]; duplicatesSkipped: number; rejectedRows: number; warnings: string[] } {
  const rows = parseCsvRows(args.csv);
  if (rows.length < 2) throw new Error("CSV must include a header row and at least one transaction.");
  const headers = rows[0].map(normalizeHeader);
  const dateIndex = findColumn(headers, HEADER_ALIASES.date);
  const descriptionIndex = findColumn(headers, HEADER_ALIASES.description);
  const amountIndex = findColumn(headers, HEADER_ALIASES.amount);
  const debitIndex = findColumn(headers, HEADER_ALIASES.debit);
  const creditIndex = findColumn(headers, HEADER_ALIASES.credit);
  if (dateIndex < 0 || descriptionIndex < 0 || (amountIndex < 0 && debitIndex < 0 && creditIndex < 0)) {
    throw new Error("Could not identify date, description, and amount columns.");
  }

  const seen = new Set(args.existingFingerprints ?? []);
  const transactions: ImportedTransaction[] = [];
  let duplicatesSkipped = 0;
  let rejectedRows = 0;

  for (const row of rows.slice(1)) {
    const postedDate = toIsoDate(row[dateIndex] ?? "");
    const descriptionRaw = (row[descriptionIndex] ?? "").trim();
    let signedAmount: number | null = null;
    if (amountIndex >= 0) signedAmount = parseMoney(row[amountIndex] ?? "");
    else {
      const debit = debitIndex >= 0 ? parseMoney(row[debitIndex] ?? "") : null;
      const credit = creditIndex >= 0 ? parseMoney(row[creditIndex] ?? "") : null;
      if (debit !== null) signedAmount = -Math.abs(debit);
      else if (credit !== null) signedAmount = Math.abs(credit);
    }
    if (!postedDate || !descriptionRaw || signedAmount === null || signedAmount === 0) { rejectedRows += 1; continue; }

    const direction: "debit" | "credit" = signedAmount < 0 ? "debit" : "credit";
    const merchant = normalizeMerchant(descriptionRaw);
    const amount = Math.abs(signedAmount);
    const fingerprint = fingerprintOf(postedDate, direction === "debit" ? -amount : amount, merchant, args.accountLastFour);
    if (seen.has(fingerprint)) { duplicatesSkipped += 1; continue; }
    seen.add(fingerprint);

    const classification = categorize(descriptionRaw, direction, args.merchantRules ?? []);
    transactions.push({
      id: crypto.randomUUID(), source: "csv", sourceFile: args.sourceFile,
      accountLastFour: args.accountLastFour ?? null, postedDate, descriptionRaw, merchant,
      amount, direction, category: classification.category, categoryConfidence: classification.confidence,
      recurring: /recurring|subscription|autopay/i.test(descriptionRaw),
      excludedFromSpending: classification.excluded,
      exclusionReason: classification.reason,
      fingerprint,
      needsReview: classification.confidence < 70 || classification.category === "other",
    });
  }

  const warnings: string[] = [];
  if (rejectedRows) warnings.push(`${rejectedRows} row(s) could not be parsed and need review.`);
  if (duplicatesSkipped) warnings.push(`${duplicatesSkipped} duplicate transaction(s) were skipped.`);
  if (transactions.some(t => t.needsReview)) warnings.push("Some merchants need category confirmation.");
  return { transactions, duplicatesSkipped, rejectedRows, warnings };
}

export function findRecurringTransactions(transactions: ImportedTransaction[]): string[] {
  const groups = new Map<string, ImportedTransaction[]>();
  for (const transaction of transactions.filter(t => t.direction === "debit" && !t.excludedFromSpending)) {
    const key = `${transaction.merchant}|${transaction.amount.toFixed(2)}`;
    groups.set(key, [...(groups.get(key) ?? []), transaction]);
  }
  return [...groups.entries()]
    .filter(([, entries]) => entries.length >= 2)
    .map(([key]) => key.split("|")[0]);
}
