import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  createSharpImageNormalizer,
  ImageNormalizationError,
  MAX_IMAGE_INPUT_BYTES,
  MAX_IMAGE_OUTPUT_BYTES,
  MAX_NORMALIZED_IMAGE_DIMENSION,
} from "./image-normalizer.server.ts";

const normalizer = createSharpImageNormalizer();

async function createFixture(format: "jpeg" | "png" | "webp", width = 32, height = 20) {
  const image = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 113, g: 72, b: 41 },
    },
  });

  if (format === "jpeg") return image.jpeg().toBuffer();
  if (format === "png") return image.png().toBuffer();
  return image.webp().toBuffer();
}

test("normalizes accepted JPEG, PNG, and WebP inputs and bounds output", async () => {
  const cases = [
    { format: "jpeg" as const, contentType: "image/jpeg" as const },
    { format: "png" as const, contentType: "image/png" as const },
    { format: "webp" as const, contentType: "image/webp" as const },
  ];

  for (const item of cases) {
    const input = await createFixture(item.format);
    const normalized = await normalizer.normalize({ bytes: input, claimedContentType: item.contentType });
    const metadata = await sharp(normalized.bytes).metadata();

    assert.equal(metadata.format, item.format);
    assert.equal(normalized.contentType, item.contentType);
    assert.equal(normalized.width, 32);
    assert.equal(normalized.height, 20);
    assert.ok(normalized.bytes.byteLength > 0);
    assert.ok(normalized.bytes.byteLength <= MAX_IMAGE_OUTPUT_BYTES);
    assert.equal(metadata.exif, undefined);
  }
});

test("rejects unsupported and mismatched media signatures before normalization", async () => {
  const jpeg = await createFixture("jpeg");

  await assert.rejects(
    normalizer.normalize({ bytes: jpeg, claimedContentType: "image/heic" }),
    (error: unknown) => error instanceof ImageNormalizationError && error.code === "unsupported_content_type",
  );
  await assert.rejects(
    normalizer.normalize({ bytes: jpeg, claimedContentType: "image/png" }),
    (error: unknown) => error instanceof ImageNormalizationError && error.code === "content_type_mismatch",
  );
  await assert.rejects(
    normalizer.normalize({ bytes: Buffer.from("not an image"), claimedContentType: "image/jpeg" }),
    (error: unknown) => error instanceof ImageNormalizationError && error.code === "unsupported_format",
  );
});

test("rejects input above the 8 MiB cap before decoding", async () => {
  await assert.rejects(
    normalizer.normalize({
      bytes: new Uint8Array(MAX_IMAGE_INPUT_BYTES + 1),
      claimedContentType: "image/jpeg",
    }),
    (error: unknown) => error instanceof ImageNormalizationError && error.code === "input_too_large",
  );
});

test("applies EXIF orientation and strips metadata from normalized output", async () => {
  const input = await sharp({
    create: {
      width: 3,
      height: 2,
      channels: 3,
      background: { r: 30, g: 90, b: 140 },
    },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();

  const normalized = await normalizer.normalize({ bytes: input, claimedContentType: "image/jpeg" });
  const metadata = await sharp(normalized.bytes).metadata();

  assert.equal(normalized.width, 2);
  assert.equal(normalized.height, 3);
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.iptc, undefined);
  assert.equal(metadata.xmp, undefined);
});

test("resizes unusually large dimensions without enlarging and rejects corrupt image data", async () => {
  const wide = await createFixture("png", MAX_NORMALIZED_IMAGE_DIMENSION + 300, 2);
  const normalized = await normalizer.normalize({ bytes: wide, claimedContentType: "image/png" });

  assert.equal(normalized.width, MAX_NORMALIZED_IMAGE_DIMENSION);
  assert.ok(normalized.height <= MAX_NORMALIZED_IMAGE_DIMENSION);

  const truncated = Buffer.from(await createFixture("jpeg"));
  truncated.fill(0, Math.floor(truncated.length / 2));
  await assert.rejects(
    normalizer.normalize({ bytes: truncated, claimedContentType: "image/jpeg" }),
    (error: unknown) => error instanceof ImageNormalizationError && error.code === "invalid_image",
  );
});
