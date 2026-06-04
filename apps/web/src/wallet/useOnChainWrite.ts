/**
 * useOnChainWrite — the app's on-chain WRITE path (like / gift), via the wallet,
 * executed through Tatum.
 *
 * THE TATUM-SAFE WRITE RECIPE (works on testnet AND mainnet — network-agnostic):
 *   1. Resolve gas EXPLICITLY with only Tatum-supported RPC: getReferenceGasPrice
 *      + getCoins. Tatum's gateway does NOT proxy `suix_getLatestSuiSystemState`,
 *      which the SDK would otherwise call while auto-resolving gas — so we set
 *      gasPrice / gasBudget / gasPayment ourselves and never trigger it.
 *   2. The wallet SIGNS the transaction.
 *   3. We EXECUTE via the dapp-kit client — which IS our throttled Tatum client
 *      (see providers.tsx `createClient`) — so the broadcast goes through Tatum.
 *
 * All RPC (gas resolution, object resolution during serialize, execute) rides the
 * `x-api-key` Tatum transport. Off-chain/sample cards (non-object-id videoId) are
 * skipped (returns null) so the caller can fall back to an optimistic-only update.
 */
import { useCallback, useRef, useState } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import type { Transaction } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import { MOVE_EVENTS, MOVE_MODULE } from "@suinami/shared";
import { buildGiftTx, buildLikeTx, buildPostVideoTx } from "@suinami/sui";
import { config, packageConfigured } from "@/config";

/** 0.1 SUI ceiling — only the actual (tiny) cost is charged; rest is refunded. */
const GAS_BUDGET = 100_000_000n;

export interface OnChainResult {
  digest: string;
  effects?: { status?: { status?: string; error?: string } };
  objectChanges?: unknown[];
}

/** A 0x… Sui object id (on-chain Video), vs a synthetic SAMPLE_FEED id. */
function isOnChainId(id: string): boolean {
  return /^0x[0-9a-fA-F]{2,64}$/.test(id);
}

export function useOnChainWrite() {
  const client = useSuiClient();
  const account = useCurrentAccount();
  const profileCache = useRef(new Map<string, string>());
  // True while a wallet-signed tx is in flight; the UI uses it to show progress
  // and ignore double-taps. The ref is the source of truth for the concurrency
  // guard (no stale-closure race); the state mirrors it for rendering.
  const busyRef = useRef(false);
  const [isPending, setIsPending] = useState(false);

  // Execute via the Tatum client (not the wallet's node) so we get parsed
  // effects/objectChanges AND the broadcast is provably through Tatum.
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction<OnChainResult>({
    execute: async ({ bytes, signature }) =>
      (await client.executeTransactionBlock({
        transactionBlock: bytes,
        signature,
        options: { showEffects: true, showObjectChanges: true },
      })) as unknown as OnChainResult,
  });

  /** Attach explicit (Tatum-safe) gas, sign with the wallet, execute via Tatum. */
  const runTx = useCallback(
    async (tx: Transaction): Promise<OnChainResult> => {
      if (!account) throw new Error("Connect a wallet first.");
      if (busyRef.current) throw new Error("A transaction is already in progress.");
      const sender = account.address;
      busyRef.current = true;
      setIsPending(true);
      try {
        const [gasPrice, coins] = [
          await client.getReferenceGasPrice(),
          await client.getCoins({ owner: sender }),
        ];
        if (coins.data.length === 0) throw new Error("No SUI in this wallet to pay for gas.");
        const gas = coins.data.reduce((m, c) =>
          BigInt(c.balance) > BigInt(m.balance) ? c : m,
        );

        tx.setSender(sender);
        tx.setGasOwner(sender);
        tx.setGasPrice(gasPrice);
        tx.setGasBudget(GAS_BUDGET);
        tx.setGasPayment([
          { objectId: gas.coinObjectId, version: gas.version, digest: gas.digest },
        ]);

        // Build to bytes through the Tatum client (object refs resolved via Tatum;
        // explicit gas means no getLatestSuiSystemState call). The wallet signs
        // THESE exact bytes — so the wallet prompt reliably opens — and we then
        // broadcast through Tatum in the custom `execute` above.
        const bytes = await tx.build({ client: client as never });
        const res = await signAndExecute({ transaction: toBase64(bytes) });
        const status = res.effects?.status?.status;
        if (status && status !== "success") {
          throw new Error(res.effects?.status?.error ?? "transaction failed");
        }
        return res;
      } finally {
        busyRef.current = false;
        setIsPending(false);
      }
    },
    [account, client, signAndExecute],
  );

  /** Like a video on-chain (mints a Like, bumps the count, emits VideoLiked). */
  const likeVideo = useCallback(
    async (videoId: string): Promise<OnChainResult | null> => {
      if (!packageConfigured || !isOnChainId(videoId)) return null;
      return runTx(buildLikeTx({ packageId: config.packageId, videoId }));
    },
    [runTx],
  );

  /** Resolve a creator's on-chain Profile id (needed by send_gift), cached. */
  const resolveProfileId = useCallback(
    async (creator: string): Promise<string | null> => {
      const cached = profileCache.current.get(creator);
      if (cached) return cached;
      const page = await client.queryEvents({
        query: {
          MoveEventType: `${config.packageId}::${MOVE_MODULE}::${MOVE_EVENTS.profileCreated}`,
        },
        limit: 50,
        order: "descending",
      });
      for (const e of page.data) {
        const f = (e.parsedJson ?? {}) as Record<string, unknown>;
        if (String(f.owner) === creator && f.profile_id) {
          const pid = String(f.profile_id);
          profileCache.current.set(creator, pid);
          return pid;
        }
      }
      return null;
    },
    [client],
  );

  /** Gift a video's creator on-chain (real SUI transfer + GiftSent event). */
  const sendGift = useCallback(
    async (args: {
      videoId: string;
      creator: string;
      amountMist: bigint;
      tier: number;
    }): Promise<OnChainResult | null> => {
      if (!packageConfigured || !isOnChainId(args.videoId)) return null;
      const profileId = await resolveProfileId(args.creator);
      if (!profileId) throw new Error("This creator has no on-chain profile yet.");
      return runTx(
        buildGiftTx({
          packageId: config.packageId,
          videoId: args.videoId,
          profileId,
          amountMist: args.amountMist,
          tier: args.tier,
        }),
      );
    },
    [runTx, resolveProfileId],
  );

  /**
   * Publish a video on-chain (`post_video`) — appends a Video to the shared Feed
   * with its Walrus blob ids (the WALRUS↔SUI bridge), caption + dims/duration.
   * The bytes are uploaded to Walrus first (POST /api/upload); this is the second
   * half that mints the Sui object. Wallet-signed, broadcast via Tatum.
   */
  const postVideo = useCallback(
    async (args: {
      blobId: string;
      posterBlob: string;
      caption: string;
      durationMs: number;
      width: number;
      height: number;
    }): Promise<OnChainResult | null> => {
      if (!packageConfigured) return null;
      return runTx(
        buildPostVideoTx({
          packageId: config.packageId,
          feedId: config.feedObjectId,
          ...args,
        }),
      );
    },
    [runTx],
  );

  return {
    likeVideo,
    sendGift,
    postVideo,
    /** True while a wallet-signed transaction is in flight. */
    isPending,
    /** True when a wallet is connected and the package is configured. */
    canWrite: Boolean(account) && packageConfigured,
    address: account?.address ?? null,
  };
}
