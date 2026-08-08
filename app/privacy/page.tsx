import { LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Privacy · Cheer" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="July 2026">
      <p>
        Cheer is built to know as little about you as possible. There are no accounts and no passwords — you connect a
        wallet, and that&apos;s your identity.
      </p>

      <h2>What stays in your browser</h2>
      <p>
        Your page settings — text, images, presets, design — live in your own browser&apos;s local storage. They&apos;re
        yours; clearing your browser data removes them.
      </p>

      <h2>What&apos;s public by nature</h2>
      <p>
        Donations, escrows, and payouts happen on a public blockchain. Wallet addresses and amounts are visible to
        anyone — that&apos;s how the chain works, and it&apos;s not something Cheer can hide.
      </p>

      <h2>What we don&apos;t do</h2>
      <p>
        We don&apos;t sell your data and we don&apos;t build advertising profiles. Your wallet connection is used only to
        sign and settle the transactions you approve.
      </p>
    </LegalPage>
  );
}
