"use client";

import { SolanaWalletProvider } from "@/lib/chain/wallet";
import { DataProvider } from "@/lib/data/DataProvider";
import { ProfileProvider } from "@/lib/data/ProfileProvider";
import { migrateLocalStorageKeys } from "@/lib/data/migrateLocalStorage";

// Rename any crown-* localStorage keys to cheer-* BEFORE the providers below read them, so a
// returning user isn't logged out with their local games gone after the Crown→Cheer rename. Runs at
// module load (client only), once per browser; idempotent thereafter.
migrateLocalStorageKeys();

// Wallet outermost (chain-agnostic of app state), then profile, then data —
// DataProvider reads the profile for getStreamer and the wallet for chain
// donations. The old WagmiProvider/QueryClient pair left with the EVM path.
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SolanaWalletProvider>
      <ProfileProvider>
        <DataProvider>{children}</DataProvider>
      </ProfileProvider>
    </SolanaWalletProvider>
  );
}
