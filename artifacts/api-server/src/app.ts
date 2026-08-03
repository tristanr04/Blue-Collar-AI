import { clerkMiddleware } from "@clerk/express";
import express, { type Express } from "express";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { makeCors } from "./middlewares/cors.js";
import { generalLimiter } from "./middlewares/rate-limit.js";
import { aiKillSwitch, aiGlobalSemaphore } from "./middlewares/ai-guard.js";
import { requireAuthenticatedUser } from "./middlewares/auth.js";

const app: Express = express();

// Replit and most production hosts terminate HTTPS behind a reverse proxy.
app.set("trust proxy", 1);

// Clerk verifies session cookies / bearer tokens and attaches auth state.
// CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY must be configured in Replit.
app.use(clerkMiddleware());

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

app.use(makeCors());

app.use(express.json({ limit: "250kb" }));
app.use(express.urlencoded({ extended: true, limit: "250kb" }));

app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  const bodyError = err as { type?: string; status?: number };
  if (bodyError.type === "entity.too.large" || bodyError.status === 413) {
    res.status(413).json({
      stage: "request_size_limit",
      error: "Request body is too large. Maximum size is 250 KB.",
    });
    return;
  }
  next(err);
});

app.use("/api", generalLimiter);

// Paid and sensitive financial endpoints require a verified user session.
app.use("/api", (req, res, next) => {
  const protectedPath =
    req.path === "/auth/me" ||
    (req.method === "POST" && (req.path === "/scan-document" || req.path === "/ai/ask"));

  if (protectedPath) {
    requireAuthenticatedUser(req, res, next);
    return;
  }
  next();
});

// Both scan and chat consume paid AI capacity.
app.use("/api", (req, res, next) => {
  if (req.method === "POST" && (req.path === "/scan-document" || req.path === "/ai/ask")) {
    aiKillSwitch(req, res, next);
    return;
  }
  next();
});

const globalAiConcurrency = aiGlobalSemaphore.middleware();
app.use("/api", (req, res, next) => {
  if (req.method === "POST" && req.path === "/scan-document") {
    globalAiConcurrency(req, res, next);
    return;
  }
  next();
});

app.use("/api", router);

app.use("/api", (req, res) => {
  res.status(404).json({
    stage: "route_not_found",
    method: req.method,
    path: req.originalUrl,
    message: `API route not found: ${req.method} ${req.originalUrl}`,
  });
});

export default app;
