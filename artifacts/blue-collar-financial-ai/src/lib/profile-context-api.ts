export const US_STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
] as const;

export type USStateCode = (typeof US_STATE_CODES)[number];

export const TAX_FILING_STATUSES = [
  "Single",
  "Married Filing Jointly",
  "Married Filing Separately",
  "Head of Household",
] as const;

export type TaxFilingStatus = (typeof TAX_FILING_STATUSES)[number];

export interface ProfileContext {
  id: string;
  userId: string;
  birthDate: string | null;
  stateCode: USStateCode | null;
  taxFilingStatus: TaxFilingStatus;
  qualifyingChildren: number;
  otherDependents: number;
  spouseHasIncome: boolean;
  additionalAnnualIncome: number;
  annualPreTaxDeductions: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileContextInput {
  birthDate?: string | null;
  stateCode?: USStateCode | null;
  taxFilingStatus: TaxFilingStatus;
  qualifyingChildren: number;
  otherDependents: number;
  spouseHasIncome: boolean;
  additionalAnnualIncome: number;
  annualPreTaxDeductions: number;
}

const API_BASE = "/api";

async function profileContextFetch(
  token: string,
  options: RequestInit = {},
): Promise<Response> {
  const res = await fetch(`${API_BASE}/profile-context`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.method && options.method !== "GET"
        ? { "Content-Type": "application/json" }
        : {}),
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ??
        `Profile context request failed (${res.status})`,
    );
  }

  return res;
}

export async function loadProfileContext(
  token: string,
): Promise<ProfileContext | null> {
  const res = await profileContextFetch(token);
  const body = (await res.json()) as { context: ProfileContext | null };
  return body.context;
}

export async function saveProfileContext(
  token: string,
  input: ProfileContextInput,
): Promise<ProfileContext> {
  const res = await profileContextFetch(token, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  const body = (await res.json()) as { context: ProfileContext };
  return body.context;
}
