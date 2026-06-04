/**
 * App-wide providers: React Query → Sui client → wallet.
 *
 * The crucial bit: SuiClientProvider's `createClient` returns OUR Tatum-backed
 * client (getSuiClient from @suinami/sui), so that EVERY read dapp-kit performs
 * — balances, owned objects, dry-runs, the wallet's own RPC reads — is routed
 * through the Tatum gateway with the `x-api-key` header, not a public fullnode.
 */
import { useState, type ComponentProps, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createNetworkConfig, SuiClientProvider, WalletProvider } from "@mysten/dapp-kit";
import { getSuiClient } from "@suinami/sui";
import { TATUM_RPC_URLS } from "@suinami/shared";
import { config } from "@/config";
import { ConnectGateProvider } from "@/wallet/ConnectGate";
import { ToastProvider } from "@/components/Toast";

// dapp-kit's createClient must return its `SuiJsonRpcClient`. We don't import
// that concrete type here (it lives deep in @mysten/sui's subpaths and the
// exact alias differs across SDK minors); instead we derive it from dapp-kit's
// own prop type and adapt getSuiClient's result at this single, clearly-marked
// boundary — the ONLY structural seam between our Tatum factory and dapp-kit.
type DappKitClient = ReturnType<
  NonNullable<ComponentProps<typeof SuiClientProvider>["createClient"]>
>;

/**
 * Network registry handed to dapp-kit, built with its own `createNetworkConfig`
 * helper so the type matches `SuiClientProvider`'s `networks` prop. Each `url`
 * is the Tatum RPC gateway, so even dapp-kit's default client factory would hit
 * Tatum — though our `createClient` below overrides it entirely.
 */
const { networkConfig } = createNetworkConfig({
  mainnet: { url: TATUM_RPC_URLS.mainnet, network: "mainnet" },
  testnet: { url: TATUM_RPC_URLS.testnet, network: "testnet" },
  devnet: { url: TATUM_RPC_URLS.devnet, network: "devnet" },
});

export function Providers({ children }: { children: ReactNode }) {
  // One QueryClient for the app lifetime. useState ensures it survives HMR /
  // re-renders without being recreated (which would drop the cache).
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Feed/leaderboard data is cheap to refetch but we don't want
            // refetch storms on focus while a video is playing.
            refetchOnWindowFocus: false,
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider
        networks={networkConfig}
        defaultNetwork={config.network}
        // TATUM INTEGRATION POINT (client side): build the dapp-kit client from
        // our gateway factory. apiKey is attached inside getTatumTransport as
        // the `x-api-key` header on every JSON-RPC request.
        createClient={() =>
          // `as unknown as` because @suinami/sui's client class identity and
          // dapp-kit's expected SuiJsonRpcClient are the same runtime client in
          // @mysten/sui 2.17, but their nominal types can differ across the SDK
          // version boundary. The runtime object is correct; we assert the type.
          getSuiClient({
            network: config.network,
            apiKey: config.tatumApiKey,
            rpcUrl: config.rpcUrl,
          }) as unknown as DappKitClient
        }
      >
        {/* autoConnect re-attaches the last-used wallet on mount. We do NOT
            render dapp-kit's built-in <ConnectButton> — a custom ConnectControl (TopBar)
            keeps the bundle small and the design on-brand. */}
        <WalletProvider autoConnect>
          <ConnectGateProvider>
            <ToastProvider>{children}</ToastProvider>
          </ConnectGateProvider>
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
