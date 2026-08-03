import { Router, type IRouter } from "express";
import OpenAI from "openai";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

// ─── POST /api/ai/ask ─────────────────────────────────────────────────────────

router.post("/ai/ask", async (req, res) => {
  const { question, financialProfile } = req.body as {
    question?: string;
    financialProfile?: Record<string, unknown>;
  };

  if (!question?.trim()) {
    res.status(400).json({ error: "Question is required." });
    return;
  }

  const profile = financialProfile ?? {};
  const profileJson = JSON.stringify(profile, null, 2);

  const systemPrompt = `You are Blue Collar AI, a plain-speaking financial assistant for trades workers — electricians, plumbers, welders, construction workers, drivers, and similar tradespeople.

CONFIRMED FINANCIAL DATA (use ONLY this — never invent):
${profileJson}

YOUR RULES:
1. Only use the confirmed data above. If data is missing, say so clearly.
2. Show your math. When you calculate, show the numbers used.
3. Separate what you know for certain from estimates.
4. Never guarantee financial outcomes.
5. State clearly you are not a licensed financial adviser.
6. Do not recommend specific securities or investments.
7. Keep it plain and direct — these are working people, not Wall Street traders.
8. When answering scenario questions (OT, pay cuts, etc.), show a clear before/after.

CALCULATION TOOLS you can use:
- Paycheck estimate: gross = (regular hrs × rate) + (OT hrs × rate × 1.5) + (DT hrs × rate × 2) + per diem
- Free cash flow: monthly take-home − monthly bills − minimum debt payments
- Debt payoff (min only): balance / minimum payment = rough months
- Debt-to-income ratio: monthly obligations / gross monthly income × 100
- Emergency fund coverage: liquid cash / monthly expenses = months covered
- Overtime needed: target amount / (hourly rate × 1.5 × hours per OT shift)

At the end of every response, add one line: "⚠️ I am not a licensed financial adviser. This is educational guidance, not financial advice."`;

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-5.6-terra",
      max_completion_tokens: 1500,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
    });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
    }
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    logger.error({ err }, "ai/ask failed");
    if (!res.headersSent) {
      res.status(500).json({ error: "AI assistant is temporarily unavailable." });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Stream error." })}\n\n`);
      res.end();
    }
  }
});

// ─── GET /api/capabilities ────────────────────────────────────────────────────

router.get("/capabilities", (_req, res) => {
  res.json({
    ai: !!(process.env.AI_INTEGRATIONS_OPENAI_API_KEY && process.env.AI_INTEGRATIONS_OPENAI_BASE_URL),
  });
});

export default router;
