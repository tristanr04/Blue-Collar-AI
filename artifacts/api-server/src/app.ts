import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Structured 404 for any /api path that didn't match a registered route.
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
