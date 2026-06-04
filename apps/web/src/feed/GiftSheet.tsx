/**
 * GiftSheet — frosted bottom-sheet gift picker.
 *
 * Slides up from the bottom (over a tap-to-dismiss scrim) and shows the four
 * GIFT_TIERS as selectable cards (glyph / name / SUI floor / blurb, each glowing
 * in its tier accent). A custom-amount field (in SUI) defaults to the selected
 * tier's floor and is editable down to that floor. Confirm either prompts for a
 * wallet connection (when disconnected) or fires the optimistic onConfirm with
 * the chosen tier + amount in MIST, then plays a brief, tier-scaled water flash
 * (ripple → tsunami) before closing.
 *
 * The sheet emits an optimistic onConfirm callback so FeedScreen can update
 * counts immediately; FeedScreen fires the real on-chain send_gift via
 * useOnChainWrite and handles the wallet flow.
 *
 * Motion is GPU-cheap (transform/opacity only) and fully reduced-motion aware:
 * with reduced motion the sheet appears instantly and the flash is skipped.
 */
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { GIFT_TIERS, suiToMist, mistToSui } from "@suinami/shared";
import type { GiftSheetProps } from "@/feed/contracts";
import { cn } from "@/lib/cn";

/** Per-tier flash intensity — drives the water-burst scale (ripple → tsunami). */
const FLASH_SCALE: Record<number, number> = {
  0: 6,
  1: 10,
  2: 16,
  3: 24,
};

/**
 * A guaranteed-defined GiftTier for the given id. GIFT_TIERS is typed as a
 * readonly array (so indexing is `GiftTier | undefined` under
 * noUncheckedIndexedAccess); this narrows to a concrete tier and falls back to
 * the first tier — which we assert is present, since GIFT_TIERS is non-empty.
 */
const FALLBACK_TIER: (typeof GIFT_TIERS)[number] = GIFT_TIERS[0]!;

function tierOrDefault(id: number): (typeof GIFT_TIERS)[number] {
  return GIFT_TIERS.find((t) => t.id === id) ?? FALLBACK_TIER;
}

export function GiftSheet({
  open,
  card,
  connected,
  onClose,
  onConfirm,
  onRequireConnect,
}: GiftSheetProps) {
  const reduce = useReducedMotion();

  // Default selection: "Splash" (id 1) reads as the friendly middle option.
  const [selectedTier, setSelectedTier] = useState<number>(1);
  // Amount as a string so the input stays controlled & editable (incl. empty).
  const [amount, setAmount] = useState<string>("");
  // Active flash tier (null = no flash playing). Drives the celebratory burst.
  const [flashTier, setFlashTier] = useState<number | null>(null);

  const activeTier = useMemo(() => tierOrDefault(selectedTier), [selectedTier]);

  // When the sheet opens (or the selected tier changes), snap the amount to the
  // tier's floor so the field always shows a valid, sendable default.
  useEffect(() => {
    if (open) setAmount(String(activeTier.floorSui));
  }, [open, activeTier.floorSui]);

  // Reset transient state whenever the sheet fully closes.
  useEffect(() => {
    if (!open) {
      setFlashTier(null);
      setSelectedTier(1);
    }
  }, [open]);

  const parsedAmount = Number.parseFloat(amount);
  const amountValid =
    Number.isFinite(parsedAmount) && parsedAmount >= activeTier.floorSui;

  function handleConfirm() {
    if (!connected) {
      onRequireConnect();
      return;
    }
    if (!amountValid) return;

    // Hand the choice up to the feed, which fires the real on-chain `send_gift`
    // (wallet-signed, broadcast via Tatum — see FeedScreen.confirmGift) and plays
    // the optimistic tip bump. The sheet itself stays presentational.
    onConfirm({ tier: selectedTier, amountMist: suiToMist(parsedAmount) });

    if (reduce) {
      onClose();
      return;
    }

    // Play the tier-scaled water flash, then close.
    setFlashTier(selectedTier);
    window.setTimeout(() => {
      setFlashTier(null);
      onClose();
    }, 720);
  }

  const handle = card?.handle ?? "creator";

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.18 }}
        >
          {/* Scrim — tap to dismiss. */}
          <button
            type="button"
            aria-label="Close gift sheet"
            onClick={onClose}
            className="absolute inset-0 bg-abyss/70"
          />

          {/* Sheet. */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`Send a gift to @${handle}`}
            className="safe-bottom safe-x relative z-10 w-full max-w-md overflow-hidden rounded-t-3xl border-t border-white/15"
            style={{
              background: "var(--surface-blur)",
              backdropFilter: "blur(24px) saturate(150%)",
              WebkitBackdropFilter: "blur(24px) saturate(150%)",
            }}
            initial={reduce ? { opacity: 0 } : { y: "100%" }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: "100%" }}
            transition={
              reduce
                ? { duration: 0 }
                : { type: "spring", stiffness: 360, damping: 34 }
            }
          >
            {/* Grab handle. */}
            <div className="flex justify-center pt-3">
              <span className="h-1 w-10 rounded-full bg-foam/25" aria-hidden />
            </div>

            {/* Header. */}
            <div className="px-5 pt-3 pb-1">
              <p className="text-xs uppercase tracking-wider text-foam/50">
                Send a gift to
              </p>
              <p className="font-display text-lg font-bold text-foam">
                @{handle}
              </p>
            </div>

            {/* Tier grid. */}
            <div className="grid grid-cols-2 gap-2.5 px-5 pt-3">
              {GIFT_TIERS.map((tier) => {
                const isSel = tier.id === selectedTier;
                return (
                  <button
                    key={tier.id}
                    type="button"
                    onClick={() => setSelectedTier(tier.id)}
                    aria-pressed={isSel}
                    className={cn(
                      "flex min-h-[44px] flex-col items-start gap-0.5 rounded-2xl border p-3 text-left",
                      "transition-transform active:scale-[0.97]",
                      isSel ? "border-transparent" : "border-white/10",
                    )}
                    style={{
                      // Accent border + soft glow when selected, faint tint idle.
                      borderColor: isSel ? tier.accent : undefined,
                      boxShadow: isSel
                        ? `0 0 0 1px ${tier.accent}, 0 8px 28px -8px ${tier.accent}`
                        : undefined,
                      background: isSel
                        ? `color-mix(in srgb, ${tier.accent} 14%, transparent)`
                        : "rgba(255,255,255,0.03)",
                    }}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="text-xl leading-none" aria-hidden>
                        {tier.glyph}
                      </span>
                      <span
                        className="tabular font-mono text-[11px]"
                        style={{ color: tier.accent }}
                      >
                        ≥ {tier.floorSui} SUI
                      </span>
                    </div>
                    <span className="mt-1 font-display text-sm font-bold text-foam">
                      {tier.name}
                    </span>
                    <span className="text-[11px] leading-tight text-foam/55">
                      {tier.blurb}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Custom amount. */}
            <div className="px-5 pt-4">
              <label
                htmlFor="gift-amount"
                className="mb-1.5 block text-xs uppercase tracking-wider text-foam/50"
              >
                Amount
              </label>
              <div
                className="flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-3"
                style={{ background: "rgba(255,255,255,0.04)" }}
              >
                <input
                  id="gift-amount"
                  type="number"
                  inputMode="decimal"
                  min={activeTier.floorSui}
                  step={0.01}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="tabular w-full bg-transparent font-mono text-lg font-semibold text-foam outline-none placeholder:text-foam/30"
                  placeholder={String(activeTier.floorSui)}
                  aria-describedby="gift-amount-hint"
                />
                <span className="font-mono text-sm font-semibold text-aqua">
                  SUI
                </span>
              </div>
              <p
                id="gift-amount-hint"
                className={cn(
                  "mt-1.5 text-[11px]",
                  amountValid ? "text-foam/45" : "text-coral",
                )}
              >
                {amountValid
                  ? `≈ ${mistToSui(suiToMist(parsedAmount)).toLocaleString(undefined, { maximumFractionDigits: 4 })} SUI to @${handle}`
                  : `Minimum for ${activeTier.name} is ${activeTier.floorSui} SUI`}
              </p>
            </div>

            {/* Confirm. */}
            <div className="px-5 pb-5 pt-4">
              <button
                type="button"
                onClick={handleConfirm}
                disabled={connected && !amountValid}
                className={cn(
                  "min-h-[48px] w-full rounded-2xl px-5 font-display text-base font-bold",
                  "text-abyss transition-transform active:scale-[0.98]",
                  "disabled:opacity-50",
                )}
                style={{
                  backgroundImage:
                    "linear-gradient(135deg, var(--c-sui), var(--c-aqua))",
                  boxShadow: "0 8px 28px -8px rgba(77,162,255,0.7)",
                }}
              >
                {connected
                  ? `Send ${activeTier.name}`
                  : "Connect wallet to gift"}
              </button>
            </div>

            {/* Tier-scaled water flash overlay — ripple → tsunami. */}
            <AnimatePresence>
              {flashTier !== null ? (
                <FlashBurst
                  key="flash"
                  accent={tierOrDefault(flashTier).accent}
                  scale={FLASH_SCALE[flashTier] ?? 6}
                />
              ) : null}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * A single expanding water ring over the sheet, scaled by tier. Pure
 * transform/opacity — cheap on the GPU. Only mounts when reduced motion is off
 * (the parent skips it under reduced motion).
 */
function FlashBurst({ accent, scale }: { accent: string; scale: number }) {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-0 grid place-items-center"
    >
      <motion.div
        className="h-24 w-24 rounded-full"
        style={{
          background: `radial-gradient(circle, ${accent} 0%, transparent 70%)`,
          willChange: "transform, opacity",
        }}
        initial={{ scale: 0.2, opacity: 0.9 }}
        animate={{ scale, opacity: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
      />
    </motion.div>
  );
}
