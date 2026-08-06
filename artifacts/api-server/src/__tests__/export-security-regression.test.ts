import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeSource = await readFile(
  new URL("../routes/export.ts", import.meta.url),
  "utf8",
);

test("personal data export remains authenticated and user scoped", () => {
  assert.match(routeSource, /requireAuthenticatedUser/);
  assert.match(routeSource, /req\.authenticatedUserId/);
  assert.match(routeSource, /eq\([^,]+\.userId, userId\)/);
  assert.doesNotMatch(routeSource, /req\.body\.userId|req\.query\.userId|req\.params\.userId/);
});

test("personal data export cannot be cached or MIME-sniffed", () => {
  assert.match(routeSource, /Cache-Control", "no-store, max-age=0"/);
  assert.match(routeSource, /Pragma", "no-cache"/);
  assert.match(routeSource, /Expires", "0"/);
  assert.match(routeSource, /X-Content-Type-Options", "nosniff"/);
  assert.match(routeSource, /Content-Disposition/);
});

test("personal data export remains rate limited", () => {
  assert.match(routeSource, /windowMs: 15 \* 60 \* 1000/);
  assert.match(routeSource, /max: 10/);
  assert.match(routeSource, /exportLimiter/);
});
