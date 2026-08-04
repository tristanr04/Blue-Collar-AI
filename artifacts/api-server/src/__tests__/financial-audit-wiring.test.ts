import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePath = new URL("../routes/financial-data.ts", import.meta.url);

async function source(): Promise<string> {
  return readFile(routePath, "utf8");
}

test("financial mutations append authenticated user-scoped audit events", async () => {
  const text = await source();

  assert.match(text, /appendAuditEvent/);
  assert.match(text, /userId:\s*input\.userId/);
  assert.match(text, /requestId:\s*requestIdFrom\(req\)/);
  assert.match(text, /source:\s*"api"/);

  for (const entity of ["profile", "paystub", "debt", "bill", "asset"]) {
    assert.match(text, new RegExp(`entityType:\\s*"${entity}"`));
  }

  for (const action of ["create", "update", "delete"]) {
    assert.match(text, new RegExp(`action:\\s*"${action}"`));
  }
});

test("audit metadata never includes request bodies or financial values", async () => {
  const text = await source();

  assert.doesNotMatch(text, /metadata:\s*req\.body/);
  assert.doesNotMatch(text, /requestBody:\s*req\.body/);
  assert.doesNotMatch(text, /metadata:\s*created/);
  assert.doesNotMatch(text, /metadata:\s*updated/);
});

test("audit persistence failures are logged without falsely failing completed writes", async () => {
  const text = await source();

  assert.match(text, /audit_append_failed/);
  assert.match(text, /financial mutation succeeded but audit event could not be persisted/);
  assert.match(text, /try\s*\{[\s\S]*await appendAuditEvent/);
  assert.match(text, /catch \(error\)/);
});

test("audit events are emitted only after successful repository mutations", async () => {
  const text = await source();

  assert.ok(text.indexOf("const created = await createPaystub") < text.indexOf('entityType: "paystub"'));
  assert.ok(text.indexOf("const created = await createDebt") < text.indexOf('entityType: "debt"'));
  assert.ok(text.indexOf("const created = await createBill") < text.indexOf('entityType: "bill"'));
  assert.ok(text.indexOf("const created = await createAsset") < text.indexOf('entityType: "asset"'));
  assert.ok(text.indexOf("const deleted = await softDeleteFinancialRecord") < text.lastIndexOf('action: "delete"'));
});
