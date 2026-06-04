/**
 * @suinami/walrus — thin client for the Walrus decentralized blob store.
 *
 * Walrus splits responsibilities across two HTTP services:
 *
 *   - PUBLISHER  (write side): you PUT raw bytes; it erasure-codes them, registers
 *                 the blob on Sui, distributes slivers to storage nodes, and returns
 *                 the content-addressed `blobId`. We talk to it in `storeBlob`.
 *   - AGGREGATOR (read side): you GET `${aggregatorUrl}/v1/blobs/${blobId}` and it
 *                 reconstructs the original bytes from the storage nodes. We talk to
 *                 it in `getBlob` / build URLs with `blobUrl`.
 *
 * The publisher and aggregator are independent endpoints (often different hosts),
 * which is why every function takes its base URL explicitly rather than sharing one.
 */

import { WALRUS_DEFAULT_EPOCHS } from "@suinami/shared";

/** Options controlling a publisher PUT. */
export interface StoreBlobOptions {
  /** Base URL of a Walrus PUBLISHER (write side), e.g. https://publisher.walrus-testnet.walrus.space */
  publisherUrl: string;
  /** How many Walrus storage epochs to pay for. Defaults to WALRUS_DEFAULT_EPOCHS. */
  epochs?: number;
  /**
   * Sui address that should OWN the resulting Walrus `Blob` Sui object.
   * See the loud comment in `storeBlob` — this is the make-or-break flag.
   */
  sendObjectTo?: string;
}

/** Normalized result of a publisher PUT, covering both Walrus response shapes. */
export interface StoreBlobResult {
  /** Content-addressed blob identifier — THE bridge value handed to Sui Move. */
  blobId: string;
  /** Sui object id of the on-chain Blob object (only present for newly-created blobs). */
  objectId?: string;
  /** Walrus epoch at which the stored blob's lifetime ends. */
  endEpoch?: number;
  /** True when Walrus already had a certified copy and reused it (no new object minted). */
  alreadyCertified: boolean;
}

/**
 * Normalize any accepted input into a fresh, ArrayBuffer-backed Uint8Array — a
 * valid fetch body in BOTH the browser (DOM lib) and Node 22 (undici). We
 * deliberately avoid naming the DOM-only `BodyInit`/`BlobPart` globals so this
 * package also typechecks under a Node-only lib (the API server imports it as
 * well as the web client).
 */
async function toRequestBody(
  data: Uint8Array | ArrayBuffer | Blob,
): Promise<Uint8Array<ArrayBuffer>> {
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  // Copy into a fresh ArrayBuffer-backed array so the type is concrete.
  return new Uint8Array(data);
}

/**
 * Safely read a nested string/number off an unknown JSON value without `any`.
 * Walrus nests fields a few levels deep and some are optional, so we walk
 * defensively rather than trusting a fixed shape.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function getString(obj: unknown, key: string): string | undefined {
  if (isRecord(obj)) {
    const v = obj[key];
    if (typeof v === "string") return v;
  }
  return undefined;
}

function getNumber(obj: unknown, key: string): number | undefined {
  if (isRecord(obj)) {
    const v = obj[key];
    if (typeof v === "number") return v;
  }
  return undefined;
}

function getChild(obj: unknown, key: string): unknown {
  return isRecord(obj) ? obj[key] : undefined;
}

/**
 * PUT raw bytes to a Walrus publisher and return the content-addressed blob id.
 *
 * URL: `${publisherUrl}/v1/blobs?epochs=${epochs ?? WALRUS_DEFAULT_EPOCHS}`
 */
export async function storeBlob(
  data: Uint8Array | ArrayBuffer | Blob,
  opts: StoreBlobOptions,
): Promise<StoreBlobResult> {
  const epochs = opts.epochs ?? WALRUS_DEFAULT_EPOCHS;

  let url = `${opts.publisherUrl}/v1/blobs?epochs=${epochs}`;

  // =========================================================================
  // !!! LOUD: WALRUS OWNERSHIP TRANSFER — THE #1 WALRUS INTEGRATION MISTAKE !!!
  // -------------------------------------------------------------------------
  // By default the PUBLISHER's own Sui account becomes the owner of the on-chain
  // Walrus `Blob` object it mints during a PUT. That is almost never what you
  // want: the blob object would belong to whoever runs the publisher, NOT to
  // our user. By appending `send_object_to=<creatorAddress>` we instruct the
  // publisher to transfer that Blob object to the CREATOR's Sui address, so the
  // user — not our infra — owns (and can later delete/extend) their own video
  // blob. Forgetting this flag silently strands ownership on the publisher; it
  // is a scored hackathon beat, so we get it right here.
  // =========================================================================
  if (opts.sendObjectTo) {
    url += `&send_object_to=${encodeURIComponent(opts.sendObjectTo)}`;
  }

  const res = await fetch(url, {
    method: "PUT",
    body: await toRequestBody(data),
  });

  if (!res.ok) {
    // Surface status + body so callers can see the publisher's error detail.
    const text = await res.text().catch(() => "");
    throw new Error(`Walrus storeBlob failed: ${res.status} ${res.statusText} ${text}`);
  }

  const json: unknown = await res.json();

  // ---- Shape A: a brand-new blob was created and certified on Sui. ----------
  //   { newlyCreated: { blobObject: { id, blobId, storage: { endEpoch } } } }
  const newlyCreated = getChild(json, "newlyCreated");
  if (newlyCreated !== undefined) {
    const blobObject = getChild(newlyCreated, "blobObject");
    const blobId = getString(blobObject, "blobId");
    const objectId = getString(blobObject, "id");
    const storage = getChild(blobObject, "storage");
    const endEpoch = getNumber(storage, "endEpoch");

    if (blobId !== undefined) {
      const result: StoreBlobResult = { blobId, alreadyCertified: false };
      if (objectId !== undefined) result.objectId = objectId;
      if (endEpoch !== undefined) result.endEpoch = endEpoch;
      return result;
    }
  }

  // ---- Shape B: Walrus already had a certified copy of these exact bytes. ----
  //   { alreadyCertified: { blobId, endEpoch?, event? } }
  const alreadyCertified = getChild(json, "alreadyCertified");
  if (alreadyCertified !== undefined) {
    const blobId = getString(alreadyCertified, "blobId");
    const endEpoch = getNumber(alreadyCertified, "endEpoch");

    if (blobId !== undefined) {
      const result: StoreBlobResult = { blobId, alreadyCertified: true };
      if (endEpoch !== undefined) result.endEpoch = endEpoch;
      return result;
    }
  }

  throw new Error(
    `Walrus storeBlob: unrecognized publisher response shape: ${JSON.stringify(json)}`,
  );
}

/**
 * Build the aggregator URL for reading a blob's bytes.
 *
 * The `blobId` here is THE bridge value also stored on-chain in the Sui Move
 * `Video` object — same content-addressed id, two storage layers.
 */
export function blobUrl(aggregatorUrl: string, blobId: string): string {
  return `${aggregatorUrl}/v1/blobs/${blobId}`;
}

/**
 * GET a blob's raw bytes from a Walrus aggregator.
 *
 * A 404 means the blob's storage epochs expired (or it never certified), so the
 * data is gone from the network — we surface that as a friendly "washed away".
 */
export async function getBlob(aggregatorUrl: string, blobId: string): Promise<Uint8Array> {
  const res = await fetch(blobUrl(aggregatorUrl, blobId));

  if (res.status === 404) {
    throw new Error("blob washed away: " + blobId);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Walrus getBlob failed: ${res.status} ${res.statusText} ${text}`);
  }

  return new Uint8Array(await res.arrayBuffer());
}
