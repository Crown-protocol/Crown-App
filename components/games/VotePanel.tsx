"use client";

import { useState } from "react";
import { useGameChain } from "@/lib/chain/useGameChain";
import { fundingVote, taskVote } from "@/lib/chain/gameFlows";
import { useCollectionState, useTaskState } from "@/lib/chain/useScopeState";

// The vote — the one part of a game that belongs to the viewers rather than to
// the creator, and the last piece of the chain path that had no way in.
//
// Two things make it honest and both come from the canister, not from us:
//   · it only appears while the scope is actually `Voting` (a closed window
//     shows a result instead of a button that would be refused);
//   · the weight is PROVEN, not claimed — the flow fetches the voter's witness
//     from the book and the game walks it. A viewer with no reputation with this
//     creator is told exactly that, rather than being quietly ignored.
//
// Voting is free: no fee, no escrow, nothing to sign but the message itself.

type Choice = "done" | "not_done";

function Buttons({
  busy,
  note,
  onVote,
  question,
}: {
  busy: Choice | null;
  note: string;
  onVote: (c: Choice) => void;
  question: string;
}) {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontWeight: 600 }}>{question}</div>
      <div className="footnote" style={{ marginTop: -4 }}>
        Your vote is weighted by the reputation you&apos;ve earned with this creator.
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="btn" disabled={!!busy} onClick={() => onVote("done")}>
          {busy === "done" ? "Sending…" : "They delivered"}
        </button>
        <button type="button" className="btn-outline" disabled={!!busy} onClick={() => onVote("not_done")}>
          {busy === "not_done" ? "Sending…" : "They didn't"}
        </button>
      </div>
      {note && <div className="footnote">{note}</div>}
    </div>
  );
}

/** Vote on a task. `task` is the base58 scope id stored when the task was born. */
export function TaskVotePanel({ task, recipient }: { task: string | undefined; recipient: string }) {
  const chain = useGameChain("task");
  const { state, live } = useTaskState(task);
  const [busy, setBusy] = useState<Choice | null>(null);
  const [note, setNote] = useState("");

  if (!live || !task || state !== "Voting") return null;

  async function vote(choice: Choice) {
    if (!chain.wallet) {
      setNote("Connect your wallet to vote — the book has to know whose reputation this is.");
      return;
    }
    setBusy(choice);
    setNote("");
    const res = await taskVote(chain.wallet, task!, choice, recipient);
    setBusy(null);
    setNote(res.ok ? "Counted." : res.error);
  }

  return <Buttons busy={busy} note={note} onVote={(c) => void vote(c)} question="Did they do it?" />;
}

/** Vote on a collection. `collection` is the hex scope id of the fundraiser. */
export function FundraiserVotePanel({ collection, recipient }: { collection: string | undefined; recipient: string }) {
  const chain = useGameChain("fundraiser");
  const { state, live } = useCollectionState(collection);
  const [busy, setBusy] = useState<Choice | null>(null);
  const [note, setNote] = useState("");

  if (!live || !collection || state !== "Voting") return null;

  async function vote(choice: Choice) {
    if (!chain.wallet) {
      setNote("Connect your wallet to vote — the book has to know whose reputation this is.");
      return;
    }
    setBusy(choice);
    setNote("");
    const res = await fundingVote(chain.wallet, collection!, choice, recipient);
    setBusy(null);
    setNote(res.ok ? "Counted." : res.error);
  }

  return (
    <Buttons
      busy={busy}
      note={note}
      onVote={(c) => void vote(c)}
      question="Did they deliver what the collection was for?"
    />
  );
}
