import { Router, type IRouter } from "express";
import { US_STATES, buildStateTaxPlan, type TaxContextInput } from "../lib/us-tax-context.js";

const router: IRouter = Router();

router.get("/tax/context/states", (_req, res) => {
  res.json({
    states: US_STATES.map(([code, name]) => ({ code, name, label: `${name} (${code})` })),
    includesDistrictOfColumbia: true,
  });
});

router.post("/tax/context/validate", (req, res) => {
  const input = req.body as TaxContextInput;
  if (!Number.isInteger(input?.taxYear) || input.taxYear < 2020 || input.taxYear > 2100) {
    res.status(400).json({ error: "A valid tax year is required." });
    return;
  }

  const plan = buildStateTaxPlan(input);
  res.status(plan.validation.valid ? 200 : 422).json(plan);
});

export default router;
