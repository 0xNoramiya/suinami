/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUI_NETWORK: "mainnet" | "testnet" | "devnet";
  readonly VITE_SUI_RPC_URL: string;
  readonly VITE_TATUM_API_KEY: string;
  readonly VITE_WALRUS_AGGREGATOR_URL: string;
  readonly VITE_SUINAMI_PACKAGE_ID: string;
  readonly VITE_SUINAMI_FEED_OBJECT_ID: string;
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
