import { Router, type IRouter } from "express";
import {
  selectRetentionNotifications,
  type NotificationCandidate,
  type NotificationHistoryItem,
  type NotificationPreferences,
} from "../lib/retention-notifications.js";

const router: IRouter = Router();

router.post("/command-center/notifications/select", (req, res) => {
  const candidates = Array.isArray(req.body?.candidates) ? req.body.candidates as NotificationCandidate[] : [];
  const history = Array.isArray(req.body?.history) ? req.body.history as NotificationHistoryItem[] : [];
  const preferences = (req.body?.preferences ?? {}) as NotificationPreferences;

  if (!candidates.length) {
    res.json({ selected: [], suppressed: [], message: "No notification candidates were provided." });
    return;
  }

  const result = selectRetentionNotifications({ candidates, history, preferences });
  res.json({
    generatedAt: new Date().toISOString(),
    ...result,
    policy: {
      defaultDailyLimit: 2,
      duplicateCooldowns: true,
      quietHoursRespected: true,
      criticalAlertsBypassQuietHours: true,
    },
  });
});

export default router;
