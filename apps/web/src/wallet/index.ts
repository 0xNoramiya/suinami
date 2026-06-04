/**
 * Wallet module barrel — the app imports the connect UI and the gate hook from
 * "@/wallet" so the dapp-kit surface stays behind a single seam.
 */
export { ConnectControl } from "@/wallet/ConnectControl";
export { useWalletGate } from "@/wallet/useWalletGate";
export { useOnChainWrite } from "@/wallet/useOnChainWrite";
export type { OnChainResult } from "@/wallet/useOnChainWrite";
export { ConnectGateProvider, useConnectGate } from "@/wallet/ConnectGate";
