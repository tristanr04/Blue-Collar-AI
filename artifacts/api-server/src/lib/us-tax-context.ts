export const US_STATES = [
  ["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],
  ["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["FL","Florida"],["GA","Georgia"],
  ["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],["IN","Indiana"],["IA","Iowa"],
  ["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],["MD","Maryland"],
  ["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],["MO","Missouri"],
  ["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],["NH","New Hampshire"],["NJ","New Jersey"],
  ["NM","New Mexico"],["NY","New York"],["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],
  ["OK","Oklahoma"],["OR","Oregon"],["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],
  ["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["UT","Utah"],["VT","Vermont"],
  ["VA","Virginia"],["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"],
  ["DC","District of Columbia"],
] as const;

export type StateCode = typeof US_STATES[number][0];
export const STATE_CODES = new Set<string>(US_STATES.map(([code]) => code));

export type WorkStateEntry = {
  state: StateCode;
  grossWages?: number;
  withholding?: number;
  daysWorked?: number;
  employerState?: StateCode;
  source?: "manual" | "paystub" | "w2";
  confidence?: number;
};

export type TaxContextInput = {
  taxYear: number;
  dateOfBirth?: string;
  residenceState?: StateCode;
  zipCode?: string;
  employerState?: StateCode;
  workStates?: WorkStateEntry[];
  detectedStates?: Array<{ state: StateCode; source: "paystub" | "w2"; confidence: number }>;
};

export function validateTaxContext(input: TaxContextInput) {
  const warnings: string[] = [];
  if (input.residenceState && !STATE_CODES.has(input.residenceState)) warnings.push("Residence state is invalid.");
  if (input.employerState && !STATE_CODES.has(input.employerState)) warnings.push("Employer state is invalid.");
  if (input.zipCode && !/^\d{5}(?:-\d{4})?$/.test(input.zipCode)) warnings.push("ZIP code must be 5 digits or ZIP+4.");
  if (input.dateOfBirth) {
    const date = new Date(`${input.dateOfBirth}T00:00:00Z`);
    const today = new Date();
    const age = today.getUTCFullYear() - date.getUTCFullYear();
    if (Number.isNaN(date.getTime()) || age < 18 || age > 120 || date > today) warnings.push("Date of birth must represent an age from 18 to 120 and cannot be in the future.");
  }
  for (const entry of input.workStates ?? []) {
    if (!STATE_CODES.has(entry.state)) warnings.push(`Invalid work state: ${entry.state}`);
    if (entry.grossWages !== undefined && entry.grossWages < 0) warnings.push(`Gross wages cannot be negative for ${entry.state}.`);
    if (entry.withholding !== undefined && entry.withholding < 0) warnings.push(`Withholding cannot be negative for ${entry.state}.`);
  }
  return { valid: warnings.length === 0, warnings };
}

export function buildStateTaxPlan(input: TaxContextInput) {
  const validation = validateTaxContext(input);
  const states = new Set<StateCode>();
  if (input.residenceState) states.add(input.residenceState);
  if (input.employerState) states.add(input.employerState);
  for (const entry of input.workStates ?? []) states.add(entry.state);
  for (const detected of input.detectedStates ?? []) states.add(detected.state);

  const confirmations: string[] = [];
  if (!input.residenceState) confirmations.push("Confirm the state where you were a legal resident for the tax year.");
  if (!(input.workStates?.length)) confirmations.push("Add each state where wages were earned, including storm or travel work.");
  if ((input.detectedStates?.length ?? 0) > 0) confirmations.push("Confirm states detected from paystubs or W-2 forms before calculating.");
  if (states.size > 1) confirmations.push("Review resident and nonresident return requirements and any available credits or reciprocity treatment.");

  return {
    taxYear: input.taxYear,
    statesToEvaluate: [...states],
    multistate: states.size > 1,
    validation,
    confirmations,
    rulesVersion: `${input.taxYear}.state-tax-context.v1`,
    rulesNotice: "State brackets, credits, reciprocity, and filing thresholds must be loaded from a tax-year-specific rules source before calculating liability.",
  };
}
