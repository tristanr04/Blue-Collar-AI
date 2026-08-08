import { fileTypeFromBuffer } from "file-type";
import sharp, { type Metadata as SharpMetadata } from "sharp";
import { computeFileFingerprint } from "./fingerprint.js";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 25_000_000;

export type SupportedUploadMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/heic"
  | "image/heif"
  | "application/pdf";

export class UploadValidationError extends Error {
  readonly stage: string;
  readonly status: number;

  constructor(stage: string, message: string, status = 422) {
    super(message);
    this.name = "UploadValidationError";
    this.stage = stage;
    this.status = status;
  }
}

const SUPPORTED_MIME_TYPES = new Set<SupportedUploadMime>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

export async function detectSupportedUpload(buffer: Buffer): Promise<SupportedUploadMime> {
  if (buffer.length === 0) {
    throw new UploadValidationError("file_validation", "The uploaded file is empty.", 400);
  }

  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError(
      "file_size_limit",
      "File is too large. Maximum upload size is 10 MB.",
      413,
    );
  }

  const detected = await fileTypeFromBuffer(buffer);
  const mime = detected?.mime as SupportedUploadMime | undefined;

  if (!mime || !SUPPORTED_MIME_TYPES.has(mime)) {
    throw new UploadValidationError(
      "mime_validation",
      "Unsupported or unrecognized file. Upload a real JPG, PNG, WebP, HEIC/HEIF, or PDF file.",
    );
  }

  return mime;
}

export interface NormalizedImage {
  buffer: Buffer;
  mime: "image/jpeg";
  width: number;
  height: number;
  fingerprint: string;
}

/**
 * Fully decodes an uploaded image, applies EXIF orientation, enforces decoded
 * pixel limits, strips metadata, and emits a normalized JPEG for the AI model.
 * Relabeling HEIC bytes as JPEG is never allowed.
 */
export async function normalizeImage(buffer: Buffer): Promise<NormalizedImage> {
  let metadata: SharpMetadata;

  try {
    metadata = await sharp(buffer, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
    }).metadata();
  } catch {
    throw new UploadValidationError(
      "image_decode",
      "The image could not be decoded. It may be corrupt or use an unsupported encoding.",
    );
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (width <= 0 || height <= 0) {
    throw new UploadValidationError("image_decode", "The image has invalid dimensions.");
  }

  if (width * height > MAX_IMAGE_PIXELS) {
    throw new UploadValidationError(
      "image_dimensions",
      "Image resolution is too large. Maximum decoded size is 25 megapixels.",
    );
  }

  try {
    const normalized = await sharp(buffer, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
    })
      .rotate()
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: normalized.data,
      mime: "image/jpeg",
      width: normalized.info.width,
      height: normalized.info.height,
      fingerprint: computeFileFingerprint(normalized.data),
    };
  } catch {
    throw new UploadValidationError(
      "image_normalization",
      "The image could not be safely normalized for scanning.",
    );
  }
}

export function isPdf(mime: SupportedUploadMime): mime is "application/pdf" {
  return mime === "application/pdf";
}
