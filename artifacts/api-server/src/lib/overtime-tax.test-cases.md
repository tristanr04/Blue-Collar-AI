# Overtime tax backend test cases

Use these fixtures when the tax-estimator task is synced.

1. **Standard FLSA overtime** — 40 regular hours, 10 hours at 1.5x, $30 regular rate. Expected cash overtime: $450; candidate qualified premium: $150; payroll-taxable overtime wages: $450.
2. **Double-time storm work** — 10 overtime hours paid at 2x, $30 regular rate, confirmed FLSA eligible. Expected cash pay: $600; candidate qualified premium remains limited to $150 unless a separately reported qualified amount is provided.
3. **Union-only premium** — overtime paid by contract but FLSA status confirmed ineligible. Expected qualified premium: $0.
4. **Weekend premium under 40 hours** — mark needs confirmation or ineligible; do not infer qualified overtime solely from a premium rate.
5. **W-2 code TT** — use reportedQualifiedOvertime as the authoritative candidate amount.
6. **Married filing separately** — deduction allowed: $0 with an eligibility warning.
7. **Cap** — non-joint candidate above $12,500 is capped at $12,500 before phaseout.
8. **MAGI phaseout** — reduce the capped deduction by 10% of MAGI above the applicable threshold.
9. **Outside 2025-2028** — deduction allowed: $0, while all overtime remains payroll-taxable wages.
10. **Missing workweek hours** — calculate only when FLSA eligibility is confirmed and return a confirmation warning.
