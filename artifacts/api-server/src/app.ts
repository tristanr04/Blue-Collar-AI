import express, { type Express } from "express";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { makeCors } from "./middlewares/cors.js";
import { generalLimiter } from "./middlewares/rate-limit.js";

const app: Express = express();

// ─── Request logging ──────────────────────────────────────────────────────────

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Development: allows localhost + *.replit.dev + *.replit.app.
// Production:  allows only origins listed in ALLOWED_ORIGINS env var.

app.use(makeCors());

// ─── Body parsing ─────────────────────────────────────────────────────────────
// 250 KB cap prevents oversized JSON payloads.

app.use(express.json({ limit: "250kb" }));
app.use(express.urlencoded({ extended: true, limit: "250kb" }));

// ─── General rate limiter (100 req / 15 min per IP) ───────────────────────────
// Applied to all /api routes. Per-endpoint stricter limits are applied in the
// route files themselves.

app.use("/api", generalLimiter);

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use("/api", router);

// ─── Structured 404 ───────────────────────────────────────────────────────────
// Must come AFTER all API routes so it only fires for unknowns.

app.use("/api", (req, res) => {
  res.status(404).json({
    stage: "route_not_found",
    method: req.method,
    path: req.originalUrl,
    message: `API route not found: ${req.method} ${req.originalUrl}`,
  });
});

export default app;
