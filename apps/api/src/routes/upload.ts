/**
 * POST /api/upload — store a video + poster on Walrus.
 *
 * Multipart body: fields `video` and `poster` (File/Blob). We push the raw
 * bytes to a Walrus publisher and return the two blob IDs. The CLIENT then
 * submits a Sui transaction (post_video) carrying these blob IDs — that Move
 * call is the on-chain half of the Walrus↔Sui bridge; here we mint the blobs.
 *
 * This route DOES hit the network (Walrus publisher) — but only when called,
 * never at startup, so it doesn't break the boot-safety contract.
 */
import { Hono } from "hono";
import {
  MAX_POSTER_UPLOAD_BYTES,
  MAX_VIDEO_UPLOAD_BYTES,
  formatMaxBytes,
  uploadQuerySchema,
  type UploadResult,
} from "@suinami/shared";
import { storeBlob } from "@suinami/walrus";
import { env } from "../env";

export const upload = new Hono();

/** Coerce the multipart Blob into bytes for Walrus. */
async function toBytes(value: Blob): Promise<Uint8Array> {
  return new Uint8Array(await value.arrayBuffer());
}

/**
 * Magic-byte sniff: identify the real container from the leading bytes, ignoring
 * the (client-spoofable) MIME type. Returns "unknown" for anything unrecognized.
 */
function sniff(b: Uint8Array): "mp4" | "webm" | "mov" | "jpeg" | "png" | "webp" | "unknown" {
  const ascii = (i: number, n: number): string => String.fromCharCode(...b.slice(i, i + n));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "webp";
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
  if (b.length >= 12 && ascii(4, 4) === "ftyp") {
    return ascii(8, 4).toLowerCase().startsWith("qt") ? "mov" : "mp4";
  }
  if (b.length >= 8 && ["moov", "mdat", "free", "wide", "skip"].includes(ascii(4, 4))) return "mov";
  return "unknown";
}
const VIDEO_KINDS = new Set(["mp4", "webm", "mov"]);
const IMAGE_KINDS = new Set(["jpeg", "png", "webp"]);

upload.post("/", async (c) => {
  // `creator` (and optional `epochs`) come from the query string.
  const parsed = uploadQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "invalid query", issues: parsed.error.issues }, 400);
  }
  const { creator, epochs } = parsed.data;

  // Cheap pre-check from the declared length — bail before buffering a giant
  // body into memory (and before paying Walrus to store it).
  const declaredLen = Number(c.req.header("content-length") ?? 0);
  const maxTotal = MAX_VIDEO_UPLOAD_BYTES + MAX_POSTER_UPLOAD_BYTES + 1024 * 1024;
  if (Number.isFinite(declaredLen) && declaredLen > maxTotal) {
    return c.json(
      { error: `Upload too large (max ${formatMaxBytes(MAX_VIDEO_UPLOAD_BYTES)} video).` },
      413,
    );
  }

  let body: Awaited<ReturnType<typeof c.req.parseBody>>;
  try {
    body = await c.req.parseBody();
  } catch {
    return c.json({ error: "invalid multipart body" }, 400);
  }

  const videoField = body["video"];
  const posterField = body["poster"];
  if (!(videoField instanceof Blob)) {
    return c.json({ error: "missing 'video' file field" }, 400);
  }
  if (!(posterField instanceof Blob)) {
    return c.json({ error: "missing 'poster' file field" }, 400);
  }

  // Size gates (authoritative — the actual buffered Blob sizes).
  if (videoField.size === 0) {
    return c.json({ error: "video file is empty" }, 400);
  }
  if (videoField.size > MAX_VIDEO_UPLOAD_BYTES) {
    return c.json({ error: `Video too large (max ${formatMaxBytes(MAX_VIDEO_UPLOAD_BYTES)}).` }, 413);
  }
  if (posterField.size > MAX_POSTER_UPLOAD_BYTES) {
    return c.json({ error: `Poster too large (max ${formatMaxBytes(MAX_POSTER_UPLOAD_BYTES)}).` }, 413);
  }

  const [videoBytes, posterBytes] = await Promise.all([
    toBytes(videoField),
    toBytes(posterField),
  ]);

  // Content gate: trust the bytes, not the client-declared MIME.
  if (!VIDEO_KINDS.has(sniff(videoBytes))) {
    return c.json({ error: "Unsupported video format — use MP4, WebM, or MOV." }, 415);
  }
  if (posterField.size > 0 && !IMAGE_KINDS.has(sniff(posterBytes))) {
    return c.json({ error: "Unsupported poster format — use JPEG, PNG, or WebP." }, 415);
  }

  try {
    const storeEpochs = epochs ?? env.WALRUS_DEFAULT_EPOCHS;

    // !!! Walrus↔Sui bridge ownership hand-off:
    // sendObjectTo = creator transfers the newly-created Walrus Blob *Sui object*
    // to the creator's address, so the creator owns the storage object on-chain
    // and can later reference its blob_id from their Video Move object.
    const [videoRes, posterRes] = await Promise.all([
      storeBlob(videoBytes, {
        publisherUrl: env.WALRUS_PUBLISHER_URL,
        epochs: storeEpochs,
        sendObjectTo: creator, // <-- creator owns the on-chain Blob object
      }),
      storeBlob(posterBytes, {
        publisherUrl: env.WALRUS_PUBLISHER_URL,
        epochs: storeEpochs,
        sendObjectTo: creator, // <-- creator owns the on-chain Blob object
      }),
    ]);

    const result: UploadResult = {
      videoBlobId: videoRes.blobId,
      posterBlobId: posterRes.blobId,
    };
    return c.json(result);
  } catch (err) {
    console.error("upload: walrus store failed:", err);
    return c.json({ error: "walrus upload failed" }, 502);
  }
});
