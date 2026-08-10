import { LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Terms · Cheer" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms" updated="July 2026">
      <p>
        Cheer is a tool for content makers to receive donations and run mini-games. Payments settle on-chain through
        escrow contracts you can read on GitHub. Cheer is non-custodial — it never holds, moves, or has access to your
        money.
      </p>

      <h2>What you agree to</h2>
      <p>
        If you set up a page, you&apos;re responsible for what you promise — a task or a fundraiser goal
        condition. Deliver it and the escrow releases to you; don&apos;t, and backers are refunded. Reputation is earned
        only on delivery. These rules are enforced by the contracts, not by us.
      </p>

      <h2>What we don&apos;t promise</h2>
      <p>
        The service is provided as-is. On-chain transactions are final except where the escrow itself refunds them.
        You&apos;re responsible for keeping your wallet secure and for any taxes on what you receive.
      </p>

      <h2>Acceptable use</h2>
      <p>
        Don&apos;t use Cheer to defraud backers, launder funds, or promise anything illegal. Pages that do can be
        delisted from discovery; the on-chain escrow always follows its own refund rules regardless.
      </p>
    </LegalPage>
  );
}
