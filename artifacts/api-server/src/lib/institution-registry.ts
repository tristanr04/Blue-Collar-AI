/**
 * Institution registry — maintainable list of known financial institutions.
 *
 * How to add a new institution:
 *   1. Add an entry to INSTITUTION_REGISTRY.
 *   2. Add all common aliases (lowercase) in the `aliases` array.
 *   3. No code changes needed anywhere else.
 *
 * Unknown institutions are NOT rejected — they fall through to the raw-name
 * fallback and the user can confirm/edit on the review screen.
 */

export type InstitutionCategory =
  | "National Bank"
  | "Regional Bank"
  | "Community Bank"
  | "Credit Union"
  | "Online Bank"
  | "Fintech"
  | "Brokerage"
  | "Robo-Adviser"
  | "Retirement Provider"
  | "IRA Custodian"
  | "Mortgage Servicer"
  | "Auto Lender"
  | "Student Loan Servicer"
  | "Personal Loan Lender"
  | "HSA Provider"
  | "Insurance"
  | "Other";

export interface InstitutionEntry {
  id: string;
  canonicalName: string;
  /** All lowercase strings used for matching */
  aliases: string[];
  categories: InstitutionCategory[];
}

export interface NormalizedInstitution {
  rawName: string;
  normalizedName: string;
  institutionCategory: string | null;
  matchedAlias: string | null;
  confidence: number;
  isKnownInstitution: boolean;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const INSTITUTION_REGISTRY: InstitutionEntry[] = [
  // ── National Banks ──────────────────────────────────────────────────────────
  {
    id: "chase",
    canonicalName: "Chase",
    aliases: ["chase", "jpmorgan chase", "jp morgan chase", "chase bank", "jpmorgan chase bank"],
    categories: ["National Bank"],
  },
  {
    id: "bofa",
    canonicalName: "Bank of America",
    aliases: ["bank of america", "bofa", "bankamerica", "bank of america n.a.", "bofas"],
    categories: ["National Bank", "Brokerage"],
  },
  {
    id: "wells_fargo",
    canonicalName: "Wells Fargo",
    aliases: ["wells fargo", "wellsfargo", "wells fargo bank", "wells fargo n.a."],
    categories: ["National Bank"],
  },
  {
    id: "citi",
    canonicalName: "Citibank",
    aliases: ["citibank", "citi", "citigroup", "citi bank", "citbank"],
    categories: ["National Bank"],
  },
  {
    id: "usbank",
    canonicalName: "U.S. Bank",
    aliases: ["u.s. bank", "us bank", "usbank", "u.s. bank national association"],
    categories: ["National Bank"],
  },
  {
    id: "pnc",
    canonicalName: "PNC",
    aliases: ["pnc", "pnc bank", "pnc financial"],
    categories: ["National Bank"],
  },
  {
    id: "truist",
    canonicalName: "Truist",
    aliases: ["truist", "truist bank", "suntrust", "bb&t"],
    categories: ["National Bank"],
  },
  {
    id: "td_bank",
    canonicalName: "TD Bank",
    aliases: ["td bank", "tdbank", "toronto-dominion bank"],
    categories: ["Regional Bank"],
  },
  {
    id: "regions",
    canonicalName: "Regions Bank",
    aliases: ["regions bank", "regions", "regions financial"],
    categories: ["Regional Bank"],
  },
  {
    id: "fifth_third",
    canonicalName: "Fifth Third Bank",
    aliases: ["fifth third", "fifth third bank", "53 bank"],
    categories: ["Regional Bank"],
  },
  {
    id: "huntington",
    canonicalName: "Huntington Bank",
    aliases: ["huntington", "huntington bank", "huntington national bank"],
    categories: ["Regional Bank"],
  },
  {
    id: "citizens",
    canonicalName: "Citizens Bank",
    aliases: ["citizens bank", "citizens financial", "citizens"],
    categories: ["Regional Bank"],
  },
  {
    id: "m&t",
    canonicalName: "M&T Bank",
    aliases: ["m&t bank", "m&t", "manufacturers and traders"],
    categories: ["Regional Bank"],
  },
  {
    id: "keybank",
    canonicalName: "KeyBank",
    aliases: ["keybank", "key bank", "keycorp"],
    categories: ["Regional Bank"],
  },
  {
    id: "synovus",
    canonicalName: "Synovus",
    aliases: ["synovus", "synovus bank"],
    categories: ["Regional Bank"],
  },
  // ── Online Banks ─────────────────────────────────────────────────────────────
  {
    id: "capital_one",
    canonicalName: "Capital One",
    aliases: ["capital one", "capitalone", "capital one 360", "capital one bank"],
    categories: ["National Bank", "Online Bank"],
  },
  {
    id: "discover_bank",
    canonicalName: "Discover Bank",
    aliases: ["discover bank", "discover", "discover online bank"],
    categories: ["Online Bank"],
  },
  {
    id: "ally",
    canonicalName: "Ally Bank",
    aliases: ["ally", "ally bank", "ally financial"],
    categories: ["Online Bank"],
  },
  {
    id: "marcus",
    canonicalName: "Marcus by Goldman Sachs",
    aliases: ["marcus", "marcus by goldman sachs", "goldman sachs bank"],
    categories: ["Online Bank"],
  },
  {
    id: "synchrony",
    canonicalName: "Synchrony Bank",
    aliases: ["synchrony", "synchrony bank", "synchrony financial"],
    categories: ["Online Bank"],
  },
  {
    id: "american_express_bank",
    canonicalName: "American Express Bank",
    aliases: ["american express bank", "amex bank", "american express national bank", "amex savings"],
    categories: ["Online Bank"],
  },
  // ── Fintech ──────────────────────────────────────────────────────────────────
  {
    id: "sofi",
    canonicalName: "SoFi",
    aliases: ["sofi", "sofi bank", "sofi technologies"],
    categories: ["Fintech"],
  },
  {
    id: "chime",
    canonicalName: "Chime",
    aliases: ["chime", "chime bank", "chime financial"],
    categories: ["Fintech"],
  },
  {
    id: "current",
    canonicalName: "Current",
    aliases: ["current", "current bank"],
    categories: ["Fintech"],
  },
  {
    id: "varo",
    canonicalName: "Varo",
    aliases: ["varo", "varo bank", "varo money"],
    categories: ["Fintech"],
  },
  {
    id: "dave",
    canonicalName: "Dave Banking",
    aliases: ["dave", "dave banking"],
    categories: ["Fintech"],
  },
  {
    id: "one_finance",
    canonicalName: "One Finance",
    aliases: ["one finance", "one bank"],
    categories: ["Fintech"],
  },
  {
    id: "cash_app",
    canonicalName: "Cash App",
    aliases: ["cash app", "cash app banking"],
    categories: ["Fintech"],
  },
  // ── Credit Unions ────────────────────────────────────────────────────────────
  {
    id: "navy_federal",
    canonicalName: "Navy Federal Credit Union",
    aliases: ["navy federal", "navy federal credit union", "nfcu"],
    categories: ["Credit Union"],
  },
  {
    id: "penfed",
    canonicalName: "PenFed Credit Union",
    aliases: ["penfed", "penfed credit union", "pentagon federal credit union"],
    categories: ["Credit Union"],
  },
  {
    id: "becu",
    canonicalName: "BECU",
    aliases: ["becu", "boeing employees credit union", "b.e.c.u."],
    categories: ["Credit Union"],
  },
  {
    id: "alliant",
    canonicalName: "Alliant Credit Union",
    aliases: ["alliant", "alliant credit union"],
    categories: ["Credit Union"],
  },
  {
    id: "tinker",
    canonicalName: "Tinker Federal Credit Union",
    aliases: ["tinker", "tinker federal", "tinker federal credit union", "tfcu"],
    categories: ["Credit Union"],
  },
  {
    id: "ttcu",
    canonicalName: "TTCU Federal Credit Union",
    aliases: ["ttcu", "ttcu federal", "ttcu federal credit union"],
    categories: ["Credit Union"],
  },
  {
    id: "oklahoma_central",
    canonicalName: "Oklahoma Central Credit Union",
    aliases: ["oklahoma central", "oklahoma central credit union", "occu"],
    categories: ["Credit Union"],
  },
  {
    id: "schools_first",
    canonicalName: "SchoolsFirst FCU",
    aliases: ["schoolsfirst", "schools first", "schoolsfirst fcu", "schoolsfirst federal credit union"],
    categories: ["Credit Union"],
  },
  // ── Brokerages ───────────────────────────────────────────────────────────────
  {
    id: "fidelity",
    canonicalName: "Fidelity",
    aliases: [
      "fidelity", "fidelity investments", "fidelity brokerage", "fidelity brokerage services",
      "fidelity netbenefits", "fidelity workplace services", "fidelity & co", "fidelity management",
    ],
    categories: ["Brokerage", "Retirement Provider", "IRA Custodian"],
  },
  {
    id: "schwab",
    canonicalName: "Charles Schwab",
    aliases: [
      "schwab", "charles schwab", "charles schwab & co", "schwab brokerage",
      "schwab retirement plan services", "schwab bank", "schwab one",
    ],
    categories: ["Brokerage", "Retirement Provider", "IRA Custodian", "Online Bank"],
  },
  {
    id: "vanguard",
    canonicalName: "Vanguard",
    aliases: [
      "vanguard", "the vanguard group", "vanguard investments", "vanguard brokerage",
      "vanguard retirement", "vanguard financial",
    ],
    categories: ["Brokerage", "Retirement Provider", "IRA Custodian"],
  },
  {
    id: "merrill",
    canonicalName: "Merrill",
    aliases: ["merrill", "merrill lynch", "merrill edge", "merrill lynch pierce fenner"],
    categories: ["Brokerage"],
  },
  {
    id: "morgan_stanley",
    canonicalName: "Morgan Stanley",
    aliases: ["morgan stanley", "morgan stanley smith barney", "etrade", "e*trade", "e-trade"],
    categories: ["Brokerage"],
  },
  {
    id: "robinhood",
    canonicalName: "Robinhood",
    aliases: ["robinhood", "robinhood financial", "robinhood markets"],
    categories: ["Brokerage"],
  },
  {
    id: "etrade",
    canonicalName: "E*TRADE",
    aliases: ["e*trade", "etrade", "e-trade", "e trade"],
    categories: ["Brokerage"],
  },
  {
    id: "interactive_brokers",
    canonicalName: "Interactive Brokers",
    aliases: ["interactive brokers", "ibkr", "ib"],
    categories: ["Brokerage"],
  },
  {
    id: "webull",
    canonicalName: "Webull",
    aliases: ["webull", "webull financial"],
    categories: ["Brokerage"],
  },
  {
    id: "m1",
    canonicalName: "M1 Finance",
    aliases: ["m1 finance", "m1", "m1 invest"],
    categories: ["Brokerage", "Robo-Adviser"],
  },
  {
    id: "public",
    canonicalName: "Public",
    aliases: ["public", "public.com", "public investing"],
    categories: ["Brokerage"],
  },
  // ── Robo-Advisers ────────────────────────────────────────────────────────────
  {
    id: "betterment",
    canonicalName: "Betterment",
    aliases: ["betterment", "betterment llc"],
    categories: ["Robo-Adviser"],
  },
  {
    id: "wealthfront",
    canonicalName: "Wealthfront",
    aliases: ["wealthfront", "wealthfront inc"],
    categories: ["Robo-Adviser"],
  },
  {
    id: "acorns",
    canonicalName: "Acorns",
    aliases: ["acorns", "acorns invest"],
    categories: ["Robo-Adviser"],
  },
  // ── Retirement / Workplace ───────────────────────────────────────────────────
  {
    id: "empower",
    canonicalName: "Empower",
    aliases: [
      "empower", "empower retirement", "empower financial services",
      "great-west financial", "great west financial",
    ],
    categories: ["Retirement Provider"],
  },
  {
    id: "principal",
    canonicalName: "Principal",
    aliases: ["principal", "principal financial", "principal financial group", "principal life"],
    categories: ["Retirement Provider", "Insurance"],
  },
  {
    id: "voya",
    canonicalName: "Voya Financial",
    aliases: ["voya", "voya financial", "ing u.s.", "reliastar life"],
    categories: ["Retirement Provider"],
  },
  {
    id: "troweprice",
    canonicalName: "T. Rowe Price",
    aliases: ["t. rowe price", "t rowe price", "troweprice", "t.rowe price"],
    categories: ["Retirement Provider", "Brokerage", "IRA Custodian"],
  },
  {
    id: "john_hancock",
    canonicalName: "John Hancock",
    aliases: ["john hancock", "john hancock retirement", "manulife"],
    categories: ["Retirement Provider", "Insurance"],
  },
  {
    id: "transamerica",
    canonicalName: "Transamerica",
    aliases: ["transamerica", "transamerica retirement solutions", "transamerica life"],
    categories: ["Retirement Provider", "Insurance"],
  },
  {
    id: "nationwide",
    canonicalName: "Nationwide",
    aliases: ["nationwide", "nationwide retirement solutions", "nationwide financial"],
    categories: ["Retirement Provider", "Insurance"],
  },
  {
    id: "lincoln_financial",
    canonicalName: "Lincoln Financial",
    aliases: ["lincoln financial", "lincoln national", "lincoln financial group"],
    categories: ["Retirement Provider", "Insurance"],
  },
  {
    id: "corebridge",
    canonicalName: "Corebridge Financial",
    aliases: ["corebridge", "corebridge financial", "aig retirement", "variable annuity life"],
    categories: ["Retirement Provider"],
  },
  {
    id: "alight",
    canonicalName: "Alight",
    aliases: ["alight", "alight solutions", "hewitt associates"],
    categories: ["Retirement Provider"],
  },
  {
    id: "adp_retirement",
    canonicalName: "ADP Retirement Services",
    aliases: ["adp retirement", "adp retirement services", "adp totalsource"],
    categories: ["Retirement Provider"],
  },
  {
    id: "paychex_retirement",
    canonicalName: "Paychex Retirement Services",
    aliases: ["paychex retirement", "paychex retirement services"],
    categories: ["Retirement Provider"],
  },
  {
    id: "human_interest",
    canonicalName: "Human Interest",
    aliases: ["human interest"],
    categories: ["Retirement Provider"],
  },
  {
    id: "guideline",
    canonicalName: "Guideline",
    aliases: ["guideline", "guideline 401k", "guideline inc"],
    categories: ["Retirement Provider"],
  },
  {
    id: "ascensus",
    canonicalName: "Ascensus",
    aliases: ["ascensus", "ascensus retirement"],
    categories: ["Retirement Provider"],
  },
  {
    id: "tsp",
    canonicalName: "Thrift Savings Plan",
    aliases: ["thrift savings plan", "tsp", "federal retirement thrift", "frtib"],
    categories: ["Retirement Provider"],
  },
  {
    id: "massmutual",
    canonicalName: "MassMutual",
    aliases: ["massmutual", "massachusetts mutual", "mass mutual", "massachusetts mutual life"],
    categories: ["Retirement Provider", "Insurance"],
  },
  {
    id: "prudential",
    canonicalName: "Prudential",
    aliases: ["prudential", "prudential financial", "prudential retirement"],
    categories: ["Retirement Provider", "Insurance"],
  },
  {
    id: "missionsquare",
    canonicalName: "MissionSquare Retirement",
    aliases: ["missionsquare", "mission square", "icma-rc", "icmarc"],
    categories: ["Retirement Provider"],
  },
  // ── Mortgage Servicers ───────────────────────────────────────────────────────
  {
    id: "rocket_mortgage",
    canonicalName: "Rocket Mortgage",
    aliases: ["rocket mortgage", "quicken loans", "rocket loans"],
    categories: ["Mortgage Servicer"],
  },
  {
    id: "loancare",
    canonicalName: "LoanCare",
    aliases: ["loancare", "loan care"],
    categories: ["Mortgage Servicer"],
  },
  {
    id: "mr_cooper",
    canonicalName: "Mr. Cooper",
    aliases: ["mr cooper", "mr. cooper", "nationstar mortgage"],
    categories: ["Mortgage Servicer"],
  },
  {
    id: "pennymac",
    canonicalName: "PennyMac",
    aliases: ["pennymac", "penny mac", "pennymac loan services"],
    categories: ["Mortgage Servicer"],
  },
  {
    id: "freedom_mortgage",
    canonicalName: "Freedom Mortgage",
    aliases: ["freedom mortgage"],
    categories: ["Mortgage Servicer"],
  },
  // ── Student Loan Servicers ───────────────────────────────────────────────────
  {
    id: "mohela",
    canonicalName: "MOHELA",
    aliases: ["mohela", "missouri higher education loan authority"],
    categories: ["Student Loan Servicer"],
  },
  {
    id: "aidvantage",
    canonicalName: "Aidvantage",
    aliases: ["aidvantage", "aid vantage"],
    categories: ["Student Loan Servicer"],
  },
  {
    id: "nelnet",
    canonicalName: "Nelnet",
    aliases: ["nelnet", "nel net"],
    categories: ["Student Loan Servicer"],
  },
  {
    id: "edfinancial",
    canonicalName: "EdFinancial",
    aliases: ["edfinancial", "ed financial", "edfinancial services"],
    categories: ["Student Loan Servicer"],
  },
  {
    id: "sallie_mae",
    canonicalName: "Sallie Mae",
    aliases: ["sallie mae", "salliemae", "navient"],
    categories: ["Student Loan Servicer"],
  },
  // ── HSA Providers ────────────────────────────────────────────────────────────
  {
    id: "optum",
    canonicalName: "Optum Bank",
    aliases: ["optum", "optum bank", "optum financial", "optum health savings"],
    categories: ["HSA Provider"],
  },
  {
    id: "health_equity",
    canonicalName: "HealthEquity",
    aliases: ["healthequity", "health equity", "wageworks"],
    categories: ["HSA Provider"],
  },
  {
    id: "further",
    canonicalName: "Further",
    aliases: ["further", "further hsa"],
    categories: ["HSA Provider"],
  },
  {
    id: "fsa_feds",
    canonicalName: "FSA Feds",
    aliases: ["fsa feds"],
    categories: ["HSA Provider"],
  },
  // ── Employee Stock Plans ─────────────────────────────────────────────────────
  {
    id: "shareworks",
    canonicalName: "Shareworks",
    aliases: ["shareworks", "shareworks by morgan stanley"],
    categories: ["Other"],
  },
  {
    id: "etrade_stock",
    canonicalName: "E*TRADE Stock Plan Administration",
    aliases: ["e*trade stock plans", "etrade stock plan", "stock plan administration"],
    categories: ["Other"],
  },
  {
    id: "computershare",
    canonicalName: "Computershare",
    aliases: ["computershare", "computershare investor services"],
    categories: ["Other"],
  },
  {
    id: "carta",
    canonicalName: "Carta",
    aliases: ["carta", "carta inc", "eShares"],
    categories: ["Other"],
  },
];

// ─── Normalizer ───────────────────────────────────────────────────────────────

/**
 * Normalize a raw institution name from a scanned document.
 * Never throws — unknown institutions fall through gracefully.
 */
export function normalizeInstitution(rawName: string | null | undefined): NormalizedInstitution {
  if (!rawName || !rawName.trim()) {
    return {
      rawName: rawName ?? "",
      normalizedName: rawName?.trim() ?? "",
      institutionCategory: null,
      matchedAlias: null,
      confidence: 0,
      isKnownInstitution: false,
    };
  }

  const lower = rawName.toLowerCase().trim();

  for (const entry of INSTITUTION_REGISTRY) {
    for (const alias of entry.aliases) {
      // Exact match = highest confidence
      if (lower === alias) {
        return {
          rawName,
          normalizedName: entry.canonicalName,
          institutionCategory: entry.categories[0] ?? null,
          matchedAlias: alias,
          confidence: 100,
          isKnownInstitution: true,
        };
      }
      // Substring match (e.g. "Fidelity NetBenefits" contains "fidelity")
      if (lower.includes(alias) || alias.includes(lower)) {
        return {
          rawName,
          normalizedName: entry.canonicalName,
          institutionCategory: entry.categories[0] ?? null,
          matchedAlias: alias,
          confidence: 80,
          isKnownInstitution: true,
        };
      }
    }
  }

  // Unknown — preserve raw name, cleaned
  return {
    rawName,
    normalizedName: rawName.trim(),
    institutionCategory: null,
    matchedAlias: null,
    confidence: 50,
    isKnownInstitution: false,
  };
}
