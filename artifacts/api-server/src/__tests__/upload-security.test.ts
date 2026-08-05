import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  MAX_UPLOAD_BYTES,
  UploadValidationError,
  detectSupportedUpload,
  normalizeImage,
} from "../lib/upload-security.js";

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
});

test("rejects corrupt image bytes during normalization", async () => {
  await expectUploadError(
    () => normalizeImage(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01])),
    "image_decode",
  );
});
