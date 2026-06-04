/**
 * useWalletGate — the single, minimal read of wallet state surfaced app-wide.
 *
 * Everything that needs to know "are we connected, and as whom" reads this hook
 * rather than calling dapp-kit directly, so the gate stays a one-line contract
 * (see WalletGate in @/feed/contracts) and consumers never depend on the SDK's
 * concrete account shape.
 */
import { useCurrentAccount } from "@mysten/dapp-kit";
import type { WalletGate } from "@/feed/contracts";

export function useWalletGate(): WalletGate {
  const account = useCurrentAccount();
  return {
    address: account?.address ?? null,
    isConnected: !!account,
  };
}
