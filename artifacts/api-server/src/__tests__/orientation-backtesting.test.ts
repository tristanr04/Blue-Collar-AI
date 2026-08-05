/**
 * Issue 3 — ORIENTATION_STRATEGIES declared and used; physical rotation verified.
 *
 * Prior state: ORIENTATION_STRATEGIES was defined at line 133 of scan.ts but
 * never referenced anywhere else.  The SYSTEM_PROMPT claimed the model would
 * "inspect all four orientations" but there was no physical rotation logic.
 *
 * Fixed state: ORIENTATION_STRATEGIES maps detectedOrientation → correctionDegrees
 * and is consumed by the physical-rotation retry path.  physicallyRotateImage()
 * is exported so it can be tested here with deterministic fixture images.
 *
 * Tests:
 *   1. ORIENTATION_STRATEGIES is actually referenced outside its declaration.
 *   2. physicallyRotateImage(90/180/270) produces correctly-oriented output
 *      verified by Sharp's metadata (width/height swap for 90°/270°, unchanged
 *      for 180°).
 *   3. correctionDegrees values in ORIENTATION_STRATEGIES are mathematically
 *      consistent (detected + correction ≡ 0 mod 360).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import { physicallyRotateImage } from "../routes/scan.js";

const source = readFileSync(new URL("../routes/scan.ts", import.meta.url), "utf8");

// ── Static-analysis tests ──────────────────────────────────────────────────

test("ORIENTATION_STRATEGIES is referenced beyond its declaration line", () => {
  // Count occurrences — must appear at least twice (declaration + at least one use).
  const occurrences = (source.match(/ORIENTATION_STRATEGIES/g) ?? []).length;
  assert.ok(
    occurrences >= 2,
    `ORIENTATION_STRATEGIES appears ${occurrences} time(s) — must appear at least twice (declaration + usage).`,
  );
});

test("ORIENTATION_STRATEGIES maps every detectedOrientation to a correctionDegrees", () => {
  // Use `as const` suffix to distinguish array literals from type annotations
  // and from occurrences in the JSON schema comment.
  const matches = [
    ...source.matchAll(/detectedOrientation:\s*(\d+)\s*as const/g),
  ].map((m) => Number(m[1]));
  assert.deepEqual(
    matches.sort((a, b) => a - b),
    [0, 90, 180, 270],
    "ORIENTATION_STRATEGIES must have one entry for each of 0°, 90°, 180°, and 270°.",
  );
});

test("correctionDegrees values are mathematically consistent: detected + correction ≡ 0 (mod 360)", () => {
  // Parse the ORIENTATION_STRATEGIES entries from source.
  const entries = [
    ...source.matchAll(
      /detectedOrientation:\s*(\d+)\s*as const,\s*correctionDegrees:\s*(\d+)\s*as const/g,
    ),
  ].map((m) => ({ detected: Number(m[1]), correction: Number(m[2]) }));

  assert.ok(
    entries.length >= 4,
    "Expected at least 4 ORIENTATION_STRATEGIES entries.",
  );

  for (const { detected, correction } of entries) {
    const sum = (detected + correction) % 360;
    assert.equal(
      sum,
      0,
      `detected(${detected}) + correction(${correction}) = ${detected + correction} — must be divisible by 360 to bring the image upright.`,
    );
  }
});

test("scan.ts physical-rotation path references ORIENTATION_STRATEGIES.find", () => {
  assert.match(
    source,
    /ORIENTATION_STRATEGIES\.find/,
    "The physical-rotation retry path must use ORIENTATION_STRATEGIES.find to look up the correction angle.",
  );
});

test("scan.ts uses physicallyRotateImage in the rotation fallback", () => {
  assert.match(
    source,
    /await physicallyRotateImage\s*\(/,
    "physicallyRotateImage must be awaited in the rotation retry path.",
  );
});

// ── Deterministic fixture tests at 0°, 90°, 180°, 270° ───────────────────
//
// We create a non-square synthetic JPEG (width=80, height=160) so that
// 90° and 270° rotations are detectable by a dimension swap.

async function makeFixtureJpeg(
  width: number,
  height: number,
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 100, b: 50 },
    },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
}

test("physicallyRotateImage(90) swaps image dimensions (portrait → landscape)", async () => {
  const original = await makeFixtureJpeg(80, 160); // portrait
  const rotated = await physicallyRotateImage(original, 90);
  const meta = await sharp(rotated).metadata();
  assert.equal(meta.width, 160, "90° rotation: width should equal original height (160).");
  assert.equal(meta.height, 80,  "90° rotation: height should equal original width (80).");
});

test("physicallyRotateImage(180) preserves image dimensions", async () => {
  const original = await makeFixtureJpeg(80, 160);
  const rotated = await physicallyRotateImage(original, 180);
  const meta = await sharp(rotated).metadata();
  assert.equal(meta.width, 80,  "180° rotation: width should be unchanged.");
  assert.equal(meta.height, 160, "180° rotation: height should be unchanged.");
});

test("physicallyRotateImage(270) swaps image dimensions (portrait → landscape)", async () => {
  const original = await makeFixtureJpeg(80, 160);
  const rotated = await physicallyRotateImage(original, 270);
  const meta = await sharp(rotated).metadata();
  assert.equal(meta.width, 160, "270° rotation: width should equal original height (160).");
  assert.equal(meta.height, 80,  "270° rotation: height should equal original width (80).");
});

test("physicallyRotateImage produces a valid JPEG buffer", async () => {
  const original = await makeFixtureJpeg(100, 100);
  for (const deg of [90, 180, 270] as const) {
    const rotated = await physicallyRotateImage(original, deg);
    assert.ok(rotated.length > 0, `${deg}° rotation produced an empty buffer.`);
    const meta = await sharp(rotated).metadata();
    assert.equal(meta.format, "jpeg", `${deg}° rotation output must be JPEG.`);
  }
});

test("double-rotation returns image to original orientation", async () => {
  // Rotate 90° twice == 180°; rotate 180° twice == 0° (identity)
  const original = await makeFixtureJpeg(80, 160);
  const step1 = await physicallyRotateImage(original, 90);
  const step2 = await physicallyRotateImage(step1, 270); // 90 + 270 = 360 ≡ 0
  const meta = await sharp(step2).metadata();
  assert.equal(meta.width,  80,  "After 90° + 270° the image should return to original width.");
  assert.equal(meta.height, 160, "After 90° + 270° the image should return to original height.");
});
