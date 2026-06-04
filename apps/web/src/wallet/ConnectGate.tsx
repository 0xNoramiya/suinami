/**
 * ConnectGate — a single, app-wide "you must connect a wallet" gate.
 *
 * Renders one controlled dapp-kit <ConnectModal> at the app root and exposes
 * `requireWallet(action)`: if a wallet is connected it runs the action, otherwise
 * it opens the wallet picker. Like / gift / comment all route through this so a
 * disconnected tap prompts connection instead of silently doing nothing.
 */
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { ConnectModal, useCurrentAccount } from "@mysten/dapp-kit";

interface ConnectGateValue {
  isConnected: boolean;
  /** Open the wallet picker. */
  openConnect: () => void;
  /** Run `action` when connected; otherwise open the wallet picker. */
  requireWallet: (action?: () => void) => void;
}

const ConnectGateContext = createContext<ConnectGateValue | null>(null);

export function ConnectGateProvider({ children }: { children: ReactNode }) {
  const account = useCurrentAccount();
  const [open, setOpen] = useState(false);

  const openConnect = useCallback(() => setOpen(true), []);
  const requireWallet = useCallback(
    (action?: () => void) => {
      if (account) action?.();
      else setOpen(true);
    },
    [account],
  );

  return (
    <ConnectGateContext.Provider
      value={{ isConnected: Boolean(account), openConnect, requireWallet }}
    >
      {children}
      <ConnectModal
        trigger={<span style={{ display: "none" }} aria-hidden />}
        open={open}
        onOpenChange={(next) => setOpen(next)}
      />
    </ConnectGateContext.Provider>
  );
}

export function useConnectGate(): ConnectGateValue {
  const value = useContext(ConnectGateContext);
  if (!value) {
    throw new Error("useConnectGate must be used within a ConnectGateProvider");
  }
  return value;
}
