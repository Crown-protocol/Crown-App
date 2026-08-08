import Link from "next/link";
import { CheerBadge } from "@/components/CheerBadge";
import { WalletConnect } from "@/components/WalletConnect";
import styles from "./DonateTopBar.module.css";

// The donation pages have no site nav of their own — this is their header: the Cheer wordmark and,
// always in reach at the top-right, the connect-wallet control. Sticky + blurred over whatever
// backdrop the content maker chose for the page.
export function DonateTopBar() {
  return (
    <header className={styles.bar}>
      <Link className={styles.brand} href="/">
        <CheerBadge size={26} />
        <span className={styles.word}>Cheer</span>
      </Link>
      <WalletConnect />
    </header>
  );
}
