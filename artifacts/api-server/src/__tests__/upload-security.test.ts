import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  MAX_UPLOAD_BYTES,
  UploadValidationError,
  detectSupportedUpload,
  normalizeImage,
} from "../lib/upload-security.js";
import { computeFileFingerprint } from "../lib/fingerprint.js";

async function expectUploadError(
  action: () => Promise<unknown>,
  expectedStage: string,
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof UploadValidationError);
    assert.equal(error.stage, expectedStage);
    return true;
  });
}

test("rejects zero-byte files", async () => {
  await expectUploadError(() => detectSupportedUpload(Buffer.alloc(0)), "file_validation");
});

test("rejects files above 10 MB", async () => {
  await expectUploadError(
    () => detectSupportedUpload(Buffer.alloc(MAX_UPLOAD_BYTES + 1)),
    "file_size_limit",
  );
});

test("rejects a fake JPEG extension represented by arbitrary bytes", async () => {
  await expectUploadError(
    () => detectSupportedUpload(Buffer.from("this is not a jpeg")),
    "mime_validation",
  );
});

test("detects and normalizes a valid PNG to metadata-free JPEG", async () => {
  const png = await sharp({
    create: {
      width: 640,
      height: 480,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .png()
    .toBuffer();

  assert.equal(await detectSupportedUpload(png), "image/png");

  const normalized = await normalizeImage(png);
  assert.equal(normalized.mime, "image/jpeg");
  assert.equal(normalized.width, 640);
  assert.equal(normalized.height, 480);
  assert.equal(normalized.buffer[0], 0xff);
  assert.equal(normalized.buffer[1], 0xd8);
  assert.equal(normalized.fingerprint, computeFileFingerprint(normalized.buffer));
});

test("canonical image fingerprints ignore removable metadata", async () => {
  const pixels = {
    create: {
      width: 24,
      height: 16,
      channels: 3 as const,
      background: { r: 23, g: 91, b: 177 },
    },
  };
  const plain = await sharp(pixels).png().toBuffer();
  const withMetadata = await sharp(pixels)
    .withMetadata({ orientation: 1 })
    .png()
    .toBuffer();

  assert.notEqual(
    computeFileFingerprint(plain),
    computeFileFingerprint(withMetadata),
    "fixture must prove raw-byte fingerprints differ",
  );

  const normalizedPlain = await normalizeImage(plain);
  const normalizedWithMetadata = await normalizeImage(withMetadata);
  assert.equal(normalizedPlain.fingerprint, normalizedWithMetadata.fingerprint);
  assert.deepEqual(normalizedPlain.buffer, normalizedWithMetadata.buffer);
});

test("canonical image fingerprints still distinguish different pixels", async () => {
  const first = await sharp({
    create: {
      width: 24,
      height: 16,
      channels: 3,
      background: { r: 23, g: 91, b: 177 },
    },
  }).png().toBuffer();
  const second = await sharp({
    create: {
      width: 24,
      height: 16,
      channels: 3,
      background: { r: 24, g: 91, b: 177 },
    },
  }).png().toBuffer();

  const normalizedFirst = await normalizeImage(first);
  const normalizedSecond = await normalizeImage(second);
  assert.notEqual(normalizedFirst.fingerprint, normalizedSecond.fingerprint);
});

test("rejects corrupt image bytes during normalization", async () => {
  await expectUploadError(
    () => normalizeImage(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01])),
    "image_decode",
  );
});
