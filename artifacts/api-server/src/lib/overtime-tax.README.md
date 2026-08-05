# Qualified overtime backend

Endpoint: `POST /tax/overtime/calculate`

The calculator separates gross overtime cash compensation from the federal qualified-overtime deduction. It treats all overtime and double-time cash compensation as payroll-taxable wages, uses separately reported qualified overtime when supplied, and otherwise estimates only the FLSA-required premium after eligibility confirmation.

The module is versioned for tax years 2025 through 2028 and returns warnings when FLSA status, workweek hours, filing eligibility, or reporting data require confirmation.
