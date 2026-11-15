import sharp from "sharp";

export const MAX_IMAGE_INPUT_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_OUTPUT_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_INPUT_PIXELS = 40_000_000;
export const MAX_NORMALIZED_IMAGE_DIMENSION = 4_096;

export type NormalizedImageContentType = "image/jpeg" | "image/png" | "image/webp";

export interface ImageNormalizationInput {
  bytes: Uint8Array;
  claimedContentType: string;
}

export interface NormalizedImage {
  bytes: Uint8Array;
  contentType: NormalizedImageContentType;
  width: number;
  height: number;
}

export type ImageNormalizationErrorCode =
  | "unsupported_content_type"
  | "content_type_mismatch"
  | "unsupported_format"
  | "input_too_large"
  | "dimensions_exceeded"
  | "animated_image_not_supported"
  | "invalid_image"
  | "normalized_image_too_large";

export class ImageNormalizationError extends Error {
  readonly code: ImageNormalizationErrorCode;

  constructor(code: ImageNormalizationErrorCode) {
    super(code);
    this.name = "ImageNormalizationError";
    this.code = code;
  }
}

export interface ImageNormalizer {
  normalize(input: ImageNormalizationInput): Promise<NormalizedImage>;
}

const FORMAT_BY_CONTENT_TYPE: Record<NormalizedImageContentType, "jpeg" | "png" | "webp"> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

function detectSignature(bytes: Uint8Array): NormalizedImageContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

function isNormalizedImageContentType(value: string): value is NormalizedImageContentType {
  return Object.hasOwn(FORMAT_BY_CONTENT_TYPE, value);
}

function throwInvalidImage(): never {
  throw new ImageNormalizationError("invalid_image");
}

export function createSharpImageNormalizer(): ImageNormalizer {
  return {
    async normalize(input) {
      if (
        !input
        || !(input.bytes instanceof Uint8Array)
        || typeof input.claimedContentType !== "string"
      ) {
        throw new ImageNormalizationError("invalid_image");
      }

      if (input.bytes.byteLength > MAX_IMAGE_INPUT_BYTES) {
        throw new ImageNormalizationError("input_too_large");
      }

      const claimedContentType = input.claimedContentType.trim().toLowerCase();
      if (!isNormalizedImageContentType(claimedContentType)) {
        throw new ImageNormalizationError("unsupported_content_type");
      }

      const signatureContentType = detectSignature(input.bytes);
      if (!signatureContentType) {
        throw new ImageNormalizationError("unsupported_format");
      }
      if (signatureContentType !== claimedContentType) {
        throw new ImageNormalizationError("content_type_mismatch");
      }

      const source = Buffer.from(input.bytes);
      const decoder = sharp(source, {
        failOn: "warning",
        limitInputPixels: MAX_IMAGE_INPUT_PIXELS,
        limitInputChannels: 4,
        unlimited: false,
      });

      let metadata: Awaited<ReturnType<typeof decoder.metadata>>;
      try {
        metadata = await decoder.metadata();
      } catch {
        throwInvalidImage();
      }

      const expectedFormat = FORMAT_BY_CONTENT_TYPE[claimedContentType];
      if (metadata.format !== expectedFormat) {
        throw new ImageNormalizationError("content_type_mismatch");
      }
      if ((metadata.pages ?? 1) > 1) {
        throw new ImageNormalizationError("animated_image_not_supported");
      }

      const width = metadata.width;
      const height = metadata.height;
      if (
        !Number.isSafeInteger(width)
        || !Number.isSafeInteger(height)
        || width! <= 0
        || height! <= 0
        || width! * height! > MAX_IMAGE_INPUT_PIXELS
      ) {
        throw new ImageNormalizationError("dimensions_exceeded");
      }

      try {
        let pipeline = decoder
          .rotate()
          .resize({
            width: MAX_NORMALIZED_IMAGE_DIMENSION,
            height: MAX_NORMALIZED_IMAGE_DIMENSION,
            fit: "inside",
            withoutEnlargement: true,
          });

        if (expectedFormat === "jpeg") pipeline = pipeline.jpeg({ quality: 88 });
        else if (expectedFormat === "png") pipeline = pipeline.png({ compressionLevel: 9 });
        else pipeline = pipeline.webp({ quality: 88 });

        const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
        if (data.byteLength > MAX_IMAGE_OUTPUT_BYTES) {
          throw new ImageNormalizationError("normalized_image_too_large");
        }
        if (
          info.format !== expectedFormat
          || !Number.isSafeInteger(info.width)
          || !Number.isSafeInteger(info.height)
          || info.width <= 0
          || info.height <= 0
          || info.width > MAX_NORMALIZED_IMAGE_DIMENSION
          || info.height > MAX_NORMALIZED_IMAGE_DIMENSION
        ) {
          throwInvalidImage();
        }

        return {
          bytes: data,
          contentType: claimedContentType,
          width: info.width,
          height: info.height,
        };
      } catch (error) {
        if (error instanceof ImageNormalizationError) throw error;
        throwInvalidImage();
      }
    },
  };
}
