import { Router, type IRouter } from "express";
import OpenAI from "openai";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

const GUIDE_PROMPT = `You are Blue Collar AI's educational tax and insurance guide for trades workers. Explain entry-level concepts plainly and practically.

You may explain:
- W-2 versus 1099 basics
- withholding versus final tax liability
- overtime, per diem, payroll taxes, standard deductions, retirement contributions, HSAs, estimated taxes, common tax forms, filing-status basics, and what records to keep
- insurance premiums, deductibles, copays, coinsurance, out-of-pocket maximums, liability limits, comprehensive, collision, uninsured motorist, replacement cost, actual cash value, term life, disability insurance, beneficiaries, claims, EOBs, and policy-renewal basics
- how to read information already extracted from the user's documents

Rules:
1. Use only supplied user data when personalizing. Never invent a policy term, tax result, eligibility determination, deduction, credit, coverage, or claim outcome.
2. Distinguish education, estimate, and confirmed document data.
3. Tax laws and insurance rules vary by tax year, state, employer plan, and policy. State the applicable assumption and ask for missing tax year/state/policy language when needed.
4. Do not provide legal conclusions, binding coverage interpretations, claim guarantees, tax-return preparation, or instructions to misrepresent facts.
5. For high-stakes situations—coverage denial, cancellation, lapse, active claim dispute, audit, levy, wage garnishment, missed filing, large balance due, business classification, or uncertain eligibility—recommend contacting the insurer/agent, licensed insurance professional, CPA/EA, or attorney as appropriate.
6. Never say an overtime paycheck has a special permanent tax rate. Explain withholding versus annual liability.
7. Never call all per diem tax-free. Explain that accountable-plan and substantiation rules matter.
8. Never recommend reducing legally required insurance limits merely to lower premiums.
9. Keep answers direct, show simple math when useful, and end with one practical next step.
10. End with: "Educational guidance only—not tax, legal, or insurance advice. Verify important decisions with a qualified professional or your policy documents."
`;

router.post("/ai/financial-guide", async (req, res) => {
  const body = req.body as {
    question?: string;
    financialProfile?: Record<string, unknown>;
    extractedDocuments?: unknown[];
    taxYear?: number;
    state?: string;
  };

  const question = body.question?.trim() ?? "";
  if (!question) {
    res.status(400).json({ error: "Question is required." });
    return;
  }
  if (question.length > 2_000) {
    res.status(400).json({ error: "Question must be 2,000 characters or fewer.", maxLength: 2_000 });
    return;
  }
  // Sanitize: limit extractedDocuments to 10 items, cap profile keys to 50
  const safeDocuments = Array.isArray(body.extractedDocuments)
    ? body.extractedDocuments.slice(0, 10)
    : [];
  const safeProfile = body.financialProfile && typeof body.financialProfile === "object"
    ? Object.fromEntries(Object.entries(body.financialProfile).slice(0, 50))
    : {};

  const context = {
    taxYear: typeof body.taxYear === "number" ? body.taxYear : null,
    state: typeof body.state === "string" ? body.state.slice(0, 2).toUpperCase() : null,
    financialProfile: safeProfile,
    extractedDocuments: safeDocuments,
  };

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.6-terra",
      max_completion_tokens: 1800,
      messages: [
        { role: "system", content: GUIDE_PROMPT },
        {
          role: "user",
          content: `CONFIRMED CONTEXT:\n${JSON.stringify(context, null, 2)}\n\nQUESTION:\n${question}`,
        },
      ],
    });

    res.json({ answer: response.choices[0]?.message?.content ?? "", usage: response.usage });
  } catch (err) {
    logger.error({ err }, "financial guide failed");
    res.status(500).json({ error: "The tax and insurance guide is temporarily unavailable." });
  }
});

export default router;
