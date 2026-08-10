"use client";

import { useEffect, useState } from "react";
import { fundingCanister, resultTag, tasksCanister } from "./games";
import { gamePrincipals } from "./games";

// The canister's own view of a scope, polled straight from its free queries.
//
// This exists because the off-chain store and the chain can disagree, and when
// they do the chain is right: a task the creator accepted in another browser, a
// collection whose voting window closed on its own, a verdict that landed while
// nobody was looking. The local store is what the UI edits; this is what it
// checks itself against.
//
// Free by construction — `get_task` / `get_collection` are `query`, so polling
// them costs nothing and needs no wallet.

export type TaskChainState = "Created" | "Accepted" | "Voting" | "DecidedSettle" | "DecidedCancel";
export type CollectionChainState = "Funding" | "Voting" | "DecidedSettle" | "DecidedRefund";

export interface ScopeState<T extends string> {
  state: T | null; // null = not materialized on the canister (yet), or not live
  live: boolean; // is this game's chain half reachable at all
  loading: boolean;
}

/** A task's state, by its base58 scope id. */
export function useTaskState(task: string | undefined, pollMs = 15_000): ScopeState<TaskChainState> {
  const [state, setState] = useState<TaskChainState | null>(null);
  const [loading, setLoading] = useState(false);
  const live = gamePrincipals.task();

  useEffect(() => {
    if (!live || !task) return;
    let dead = false;
    const read = async () => {
      setLoading(true);
      try {
        const c = await tasksCanister();
        if (!c || dead) return;
        const answer = await c.get_task(task);
        if (dead) return;
        setState(answer.length ? (resultTag(answer[0]) as TaskChainState) : null);
      } catch {
        // Unreachable gateway — keep the last known state rather than blanking it.
      } finally {
        if (!dead) setLoading(false);
      }
    };
    void read();
    const t = setInterval(() => void read(), pollMs);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [task, live, pollMs]);

  return { state, live, loading };
}

/** A collection's state (plus its window), by its hex scope id. */
export function useCollectionState(
  collection: string | undefined,
  pollMs = 15_000
): ScopeState<CollectionChainState> & { createdAt: number | null; duration: number | null } {
  const [state, setState] = useState<CollectionChainState | null>(null);
  const [createdAt, setCreatedAt] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const live = gamePrincipals.fundraiser();

  useEffect(() => {
    if (!live || !collection) return;
    let dead = false;
    const read = async () => {
      setLoading(true);
      try {
        const c = await fundingCanister();
        if (!c || dead) return;
        const answer = await c.get_collection(collection);
        if (dead) return;
        if (!answer.length) {
          setState(null);
          return;
        }
        const view = answer[0];
        setState(resultTag(view.state) as CollectionChainState);
        setCreatedAt(Number(view.created_at));
        setDuration(Number(view.duration));
      } catch {
        // Same as above: a flaky gateway must not erase what we already know.
      } finally {
        if (!dead) setLoading(false);
      }
    };
    void read();
    const t = setInterval(() => void read(), pollMs);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [collection, live, pollMs]);

  return { state, live, loading, createdAt, duration };
}
