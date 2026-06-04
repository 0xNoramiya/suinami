/**
 * ConnectControl — dapp-kit's <ConnectButton /> dressed for the water theme.
 *
 * dapp-kit ships its own modal + styled button; we import its CSS once here and
 * wrap the button in a frosted pill container so it sits naturally beside the
 * "suinami" wordmark in the TopBar. When connected, dapp-kit's button collapses
 * to a truncated address — we present our own truncation in mono for a tighter,
 * on-brand fit and let the button's click open dapp-kit's account dropdown.
 *
 * The dapp-kit stylesheet must load before our overrides so our utilities win
 * the cascade; importing it at the top of this module guarantees that order.
 */
import "@mysten/dapp-kit/dist/index.css";
import { ConnectButton } from "@mysten/dapp-kit";
import { cn } from "@/lib/cn";
import { useWalletGate } from "@/wallet/useWalletGate";

/** 0x1234… abcd — keeps the address legible without overflowing the bar. */
function truncateAddress(address: string): string {
  if (address.length <= 13) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

interface ConnectControlProps {
  className?: string;
}

export function ConnectControl({ className }: ConnectControlProps) {
  const { address, isConnected } = useWalletGate();

  return (
    <div
      className={cn(
        // Frosted pill that hosts dapp-kit's button. The inner button inherits
        // these rounded edges via the [&_button] descendant overrides below.
        "suinami-connect inline-flex items-center overflow-hidden rounded-full border border-white/15",
        "min-h-[40px]",
        className,
      )}
      style={{
        background: "var(--surface-blur)",
        backdropFilter: "blur(14px) saturate(140%)",
        WebkitBackdropFilter: "blur(14px) saturate(140%)",
      }}
    >
      <ConnectButton
        // Tailwind descendant selectors retheme dapp-kit's internal button so we
        // never fight its inline defaults: transparent fill, foam text, mono
        // address, tight padding, and a 44px-friendly hit area.
        className={cn(
          "[&>button]:!min-h-[40px] [&>button]:!rounded-full [&>button]:!border-0",
          "[&>button]:!bg-transparent [&>button]:!px-4 [&>button]:!py-0",
          "[&>button]:!font-display [&>button]:!text-sm [&>button]:!font-semibold",
          "[&>button]:!text-foam [&>button]:!shadow-none",
          "[&>button]:active:!scale-95 [&>button]:!transition-transform",
        )}
        connectText={
          <span
            className="bg-gradient-to-br from-[var(--c-sui)] to-[var(--c-aqua)] bg-clip-text font-semibold text-transparent"
          >
            Connect
          </span>
        }
      />
      {/* When connected, surface our own tidy truncation in mono. dapp-kit's
          button already shows an address, but this guarantees the on-brand
          monospace styling regardless of SDK markup changes. It is decorative
          (the underlying button stays the interactive target). */}
      {isConnected && address ? (
        <span
          aria-hidden
          className="tabular pointer-events-none pr-3 font-mono text-xs text-aqua/90"
        >
          {truncateAddress(address)}
        </span>
      ) : null}
    </div>
  );
}
