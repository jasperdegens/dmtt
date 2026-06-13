"use client";

// components/scene/PirateContext.tsx — the captain's state, shared across the scene.
//
// One provider holds the current PirateState; the chat flow and the step cards drive it.
// Three layers compose the visible state:
//   • resting  — the steady state the captain returns to (default "idle").
//   • blink    — a periodic "waiting" glance: every ~10s, when nothing else is happening,
//                the captain plays the waiting clip once, then settles back to idle.
//   • transient — a temporary override during an action (thinking / encrypting / …), held
//                long enough for its clip to play through (holdMs).
// The visible state is `transient ?? blink ?? resting`, so an action wins over the glance,
// which wins over the resting idle — and nothing has to be restored by the caller.
//
// usePirate() is safe OUTSIDE a provider (it returns no-ops), so a card can call it
// without caring whether it's mounted inside the scene.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { holdMs, withMinDuration, type PirateState } from "@/lib/pirate.ts";

interface PirateApi {
  /** The currently visible state: transient override if any, else the resting state. */
  state: PirateState;
  /** Set the steady state the captain rests in between actions. */
  setResting: (s: PirateState) => void;
  /** Show `state` while `work` runs (held ≥ the clip's length), then fall back. */
  runWhile: <T>(state: PirateState, work: () => Promise<T>, min?: number) => Promise<T>;
  /** Briefly show `state` (e.g. "talking" as a new line lands), one clip loop, then fall back. */
  pulse: (state: PirateState, ms?: number) => void;
}

const noop: PirateApi = {
  state: "idle",
  setResting: () => {},
  runWhile: (_s, work) => work(),
  pulse: () => {},
};

const PirateContext = createContext<PirateApi | null>(null);

/** How often the idle captain plays a one-off "waiting" glance. */
const GLANCE_EVERY_MS = 10_000;

export function PirateProvider({ children }: { children: ReactNode }) {
  const [resting, setResting] = useState<PirateState>("idle");
  const [transient, setTransient] = useState<PirateState | null>(null);
  const [blink, setBlink] = useState<PirateState | null>(null);
  // A monotonic token so overlapping transients never clear each other early — only
  // the most recent owner is allowed to clear the override.
  const tokenRef = useRef(0);
  // Mirror the transient so the glance interval can see "is an action happening?".
  const transientRef = useRef<PirateState | null>(null);
  useEffect(() => {
    transientRef.current = transient;
  }, [transient]);

  const runWhile = useCallback(
    async <T,>(state: PirateState, work: () => Promise<T>, min: number = holdMs(state)) => {
      const token = ++tokenRef.current;
      setBlink(null); // a real action cancels any idle glance
      setTransient(state);
      try {
        return await withMinDuration(work, min);
      } finally {
        if (tokenRef.current === token) setTransient(null);
      }
    },
    [],
  );

  const pulse = useCallback((state: PirateState, ms: number = holdMs(state)) => {
    const token = ++tokenRef.current;
    setBlink(null);
    setTransient(state);
    setTimeout(() => {
      if (tokenRef.current === token) setTransient(null);
    }, ms);
  }, []);

  // Idle by default; every ~10s, when no action is showing, glance once (play the waiting
  // clip), then settle back to idle.
  useEffect(() => {
    const id = setInterval(() => {
      if (transientRef.current) return; // an action is on screen — skip the glance
      setBlink("waiting");
      setTimeout(() => setBlink((b) => (b === "waiting" ? null : b)), holdMs("waiting"));
    }, GLANCE_EVERY_MS);
    return () => clearInterval(id);
  }, []);

  const api = useMemo<PirateApi>(
    () => ({ state: transient ?? blink ?? resting, setResting, runWhile, pulse }),
    [transient, blink, resting, runWhile, pulse],
  );

  return <PirateContext.Provider value={api}>{children}</PirateContext.Provider>;
}

export function usePirate(): PirateApi {
  return useContext(PirateContext) ?? noop;
}
