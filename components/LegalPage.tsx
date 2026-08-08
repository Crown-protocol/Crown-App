import type { ReactNode } from "react";
import { TopNav } from "@/components/TopNav";
import { SiteFooter } from "@/components/SiteFooter";
import styles from "./LegalPage.module.css";

// Shared shell for the two legal pages (Terms, Privacy) so they can't drift apart. Plain first-party
// copy describing how Cheer actually works — a plain-language summary, not a substitute for the full
// legal text a production launch would attach.
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className={styles.wrap}>
      <TopNav />
      <article className={styles.article}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.updated}>Last updated {updated}</p>
        {children}
        <p className={styles.note}>
          This is a plain-language summary of how Cheer works today, not a substitute for full legal terms.
        </p>
      </article>
      <SiteFooter />
    </main>
  );
}
