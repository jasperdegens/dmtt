"use client";

// components/scene/PirateContext.tsx — the captain's state, shared across the scene.
//
// One provider holds the current PirateState; the chat flow and the step cards drive
// it. Two layers compose the visible state:
//   • resting  — the steady state the captain returns to (waiting / idle).
//   • transient — a temporary override during an action (thinking / encrypting / …).
// The visible state is `transient ?? resting`, so an action shows its own animation
// and then cleanly falls back without the caller having to restore anything.
//
// usePirate() is safe OUTSIDE a provider (it returns no-ops), so a card can call it
// without caring whether it's mounted inside the scene.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { MIN_ACTION_MS, withMinDuration, type PirateState } from "@/lib/pirate.ts";

interface PirateApi {
  /** The currently visible state: transient override if any, else the resting state. */
  state: PirateState;
  /** Set the steady state the captain rests in between actions. */
  setResting: (s: PirateState) => void;
  /** Show `state` while `work` runs (with a MIN_ACTION_MS floor), then fall back. */
  runWhile: <T>(state: PirateState, work: () => Promise<T>, min?: number) => Promise<T>;
  /** Briefly show `state` (e.g. "talking" as a new line appears), then fall back. */
  pulse: (state: PirateState, ms?: number) => void;
}

const noop: PirateApi = {
  state: "idle",
  setResting: () => {},
  runWhile: (_s, work) => work(),
  pulse: () => {},
};

const PirateContext = createContext<PirateApi | null>(null);

export function PirateProvider({ children }: { children: ReactNode }) {
  const [resting, setResting] = useState<PirateState>("idle");
  const [transient, setTransient] = useState<PirateState | null>(null);
  // A monotonic token so overlapping transients never clear each other early — only
  // the most recent owner is allowed to clear the override.
  const tokenRef = useRef(0);

  const runWhile = useCallback(
    async <T,>(state: PirateState, work: () => Promise<T>, min: number = MIN_ACTION_MS) => {
      const token = ++tokenRef.current;
      setTransient(state);
      try {
        return await withMinDuration(work, min);
      } finally {
        if (tokenRef.current === token) setTransient(null);
      }
    },
    [],
  );

  const pulse = useCallback((state: PirateState, ms = 1600) => {
    const token = ++tokenRef.current;
    setTransient(state);
    setTimeout(() => {
      if (tokenRef.current === token) setTransient(null);
    }, ms);
  }, []);

  const api = useMemo<PirateApi>(
    () => ({ state: transient ?? resting, setResting, runWhile, pulse }),
    [transient, resting, runWhile, pulse],
  );

  return <PirateContext.Provider value={api}>{children}</PirateContext.Provider>;
}

export function usePirate(): PirateApi {
  return useContext(PirateContext) ?? noop;
}
