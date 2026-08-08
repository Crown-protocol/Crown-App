"use client";

import { useCallback, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface Pending {
  body: string;
  confirmLabel: string;
  busyLabel?: string;
  danger?: boolean;
  run: () => void | Promise<{ ok: boolean; reason?: string } | void>;
}

/**
 * Puts one confirmation in front of a dangerous action, without every screen re-inventing the
 * state, the dialog and the wording.
 *
 *   const confirm = useConfirm();
 *   <button onClick={() => confirm(dangerCopy.bid(amount), () => void placeBid())}>…</button>
 *   {confirm.dialog}
 *
 * The copy always comes from lib/data/dangerous.ts, so the title and the Cancel button are identical
 * everywhere and only the sentence in the middle changes. Async actions keep the dialog open until
 * they resolve — money that is still in flight must not look confirmed.
 */
export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null);

  const ask = useCallback(
    (
      copy: { body: string; confirmLabel: string; busyLabel?: string },
      run: () => void | Promise<{ ok: boolean; reason?: string } | void>,
      opts?: { danger?: boolean }
    ) => {
      setPending({ ...copy, danger: opts?.danger, run });
    },
    []
  );

  const dialog = pending ? (
    <ConfirmDialog
      body={pending.body}
      confirmLabel={pending.confirmLabel}
      busyLabel={pending.busyLabel}
      danger={pending.danger}
      onCancel={() => setPending(null)}
      onConfirm={() => {
        const out = pending.run();
        // Synchronous action: it's done, close. Async: let the dialog show progress and only close on
        // success — ConfirmDialog keeps itself open and surfaces the reason when the promise fails.
        if (!out || typeof (out as Promise<unknown>).then !== "function") {
          setPending(null);
          return;
        }
        return (out as Promise<{ ok: boolean; reason?: string } | void>).then((r) => {
          if (!r || r.ok !== false) setPending(null);
          return r;
        });
      }}
    />
  ) : null;

  // Callable, with the element hanging off it — so a screen adds `{confirm.dialog}` once and calls
  // `confirm(...)` wherever it needs to.
  return Object.assign(ask, { dialog });
}
