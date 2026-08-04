import express, { type Express } from "express";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware.js";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { makeCors } from "./middlewares/cors.js";
import { generalLimiter } from "./middlewares/rate-limit.js";

const app: Express = express();
const MAX_SCAN_UPLOAD_BYTES = 10 * 1024 * 1024;

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

// ─── Clerk proxy — BEFORE body parsers (streams raw bytes) ────────────────────
// Only active in production; no-op in development.

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// ─── CORS ─────────────────────────────────────────────────────────────────────

app.use(makeCors());

// Reject obviously oversized multipart scans before Multer buffers the entire
// request in memory. Multer retains its own file-size limit as a second line of
// defense because Content-Length can be omitted or falsified.
app.use("/api/scan-document", (req, res, next) => {
  if (req.method !== "POST") {
    next();
    return;
  }

  const contentLength = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_SCAN_UPLOAD_BYTES) {
    logger.warn(
      { contentLength, maxBytes: MAX_SCAN_UPLOAD_BYTES, ip: req.ip },
      "scanner upload rejected before buffering",
    );
    res.status(413).json({
      stage: "upload_size_limit",
      error: "Document is too large. Maximum upload size is 10 MB.",
    });
    return;
  }

  next();
});

// ─── Body parsing (250 KB cap) ────────────────────────────────────────────────

app.use(express.json({ limit: "250kb" }));
app.use(express.urlencoded({ extended: true, limit: "250kb" }));

// ─── General rate limiter (100 req / 15 min per IP) ───────────────────────────

app.use("/api", generalLimiter);

// ─── Clerk session middleware ─────────────────────────────────────────────────
// Populates req.auth on every request. Routes call requireAuthenticatedUser()
// to enforce it. Reads CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY from env.

app.use(clerkMiddleware());

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
