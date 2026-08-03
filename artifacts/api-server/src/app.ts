import express, { type Express } from "express";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { makeCors } from "./middlewares/cors.js";
import { generalLimiter } from "./middlewares/rate-limit.js";

const app: Express = express();

// Replit and most production hosts terminate HTTPS behind a reverse proxy.
// Trust exactly one proxy hop so req.ip reflects the real client instead of the
// shared proxy address. Without this, all users can share one rate-limit bucket.
app.set("trust proxy", 1);

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

app.use(makeCors());

// ─── Body parsing ─────────────────────────────────────────────────────────────

app.use(express.json({ limit: "250kb" }));
app.use(express.urlencoded({ extended: true, limit: "250kb" }));

// Return a structured response for oversized JSON/form requests instead of an
// HTML Express error page.
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  const bodyError = err as { type?: string; status?: number; message?: string };
  if (bodyError.type === "entity.too.large" || bodyError.status === 413) {
    res.status(413).json({
      stage: "request_size_limit",
      error: "Request body is too large. Maximum size is 250 KB.",
    });
    return;
  }
  next(err);
});

// ─── General rate limiter (100 req / 15 min per IP) ───────────────────────────

app.use("/api", generalLimiter);

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use("/api", router);

// ─── Structured 404 ───────────────────────────────────────────────────────────

app.use("/api", (req, res) => {
  res.status(404).json({
    stage: "route_not_found",
    method: req.method,
    path: req.originalUrl,
    message: `API route not found: ${req.method} ${req.originalUrl}`,
  });
});

export default app;
