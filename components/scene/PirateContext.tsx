"use client";

// components/scene/PirateContext.tsx — the captain's state, shared across the scene.
//
// One provider holds the current PirateState; the chat flow and the step cards drive it.
// Three layers compose the visible state:
//   • resting  — the steady state the captain returns to (default "idle").
//   • blink    — a periodic "waiting" glance: every ~10s, when nothing else is happening,
//                the captain plays the waiting clip once, then settles back to idle.
//   • transient — a temporary override during an action (talking / encrypting / …), held
//                until the active clip reaches a loop boundary.
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

import { holdMs, type PirateState } from "@/lib/pirate.ts";

interface PirateApi {
  /** The currently visible state: transient override if any, else the resting state. */
  state: PirateState;
  /** Set the steady state the captain rests in between actions. */
  setResting: (s: PirateState) => void;
  /** Show `state` while `work` runs, then fall back on the next clip boundary. */
  runWhile: <T>(state: PirateState, work: () => Promise<T>, min?: number) => Promise<T>;
  /** Briefly show `state` (e.g. "talking" as a new line lands), then fall back. */
  pulse: (state: PirateState, ms?: number) => void;
  /** Internal: PirateStage calls this when the active video completes a loop. */
  completeCycle: (state: PirateState) => void;
}

const noop: PirateApi = {
  state: "idle",
  setResting: () => {},
  runWhile: (_s, work) => work(),
  pulse: () => {},
  completeCycle: () => {},
};

const PirateContext = createContext<PirateApi | null>(null);

/** How often the idle captain plays a one-off "waiting" glance. */
const GLANCE_EVERY_MS = 10_000;

type PendingClip = {
  token: number;
  state: PirateState;
  done: boolean;
  resolve: () => void;
  fallbackId: ReturnType<typeof setTimeout> | null;
};

export function PirateProvider({ children }: { children: ReactNode }) {
  const [resting, setResting] = useState<PirateState>("idle");
  const [transient, setTransient] = useState<PirateState | null>(null);
  const [blink, setBlink] = useState<PirateState | null>(null);
  // A monotonic token so overlapping transients never clear each other early — only
  // the most recent owner is allowed to clear the override.
  const tokenRef = useRef(0);
  const pendingRef = useRef<PendingClip | null>(null);
  const blinkFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror the transient so the glance interval can see "is an action happening?".
  const transientRef = useRef<PirateState | null>(null);
  useEffect(() => {
    transientRef.current = transient;
  }, [transient]);

  const clearBlinkFallback = useCallback(() => {
    if (blinkFallbackRef.current) clearTimeout(blinkFallbackRef.current);
    blinkFallbackRef.current = null;
  }, []);

  const releasePending = useCallback((pending: PendingClip) => {
    if (pending.fallbackId) clearTimeout(pending.fallbackId);
    pending.fallbackId = null;
    pending.resolve();
  }, []);

  const clearPendingIfReady = useCallback(
    (token: number): boolean => {
      const pending = pendingRef.current;
      if (!pending || pending.token !== token || !pending.done) return false;
      pendingRef.current = null;
      if (tokenRef.current === token) setTransient(null);
      releasePending(pending);
      return true;
    },
    [releasePending],
  );

  const scheduleFallback = useCallback(
    (token: number, state: PirateState, ms: number) => {
      const pending = pendingRef.current;
      if (!pending || pending.token !== token) return;
      if (pending.fallbackId) clearTimeout(pending.fallbackId);
      pending.fallbackId = setTimeout(() => {
        const latest = pendingRef.current;
        if (!latest || latest.token !== token) return;
        if (!clearPendingIfReady(token)) scheduleFallback(token, state, ms);
      }, ms);
    },
    [clearPendingIfReady],
  );

  const startPending = useCallback(
    (state: PirateState, done: boolean, fallbackMs: number): Promise<void> => {
      if (pendingRef.current) {
        releasePending(pendingRef.current);
        pendingRef.current = null;
      }
      const token = ++tokenRef.current;
      let resolve!: () => void;
      const boundary = new Promise<void>((r) => {
        resolve = r;
      });
      pendingRef.current = { token, state, done, resolve, fallbackId: null };
      clearBlinkFallback();
      setBlink(null);
      setTransient(state);
      scheduleFallback(token, state, fallbackMs);
      return boundary;
    },
    [clearBlinkFallback, releasePending, scheduleFallback],
  );

  const runWhile = useCallback(
    async <T,>(state: PirateState, work: () => Promise<T>, min: number = holdMs(state)) => {
      const boundary = startPending(state, false, min);
      const token = tokenRef.current;
      let result: T | undefined;
      let error: unknown;
      try {
        result = await work();
      } catch (err) {
        error = err;
      }
      const pending = pendingRef.current;
      if (pending?.token === token) pending.done = true;
      await boundary;
      if (error) throw error;
      return result as T;
    },
    [startPending],
  );

  const pulse = useCallback(
    (state: PirateState, ms: number = holdMs(state)) => {
      void startPending(state, true, ms);
    },
    [startPending],
  );

  const completeCycle = useCallback(
    (state: PirateState) => {
      const pending = pendingRef.current;
      if (pending?.state === state) {
        clearPendingIfReady(pending.token);
        return;
      }
      clearBlinkFallback();
      setBlink((b) => (b === state ? null : b));
    },
    [clearBlinkFallback, clearPendingIfReady],
  );

  // Idle by default; every ~10s, when no action is showing, glance once (play the waiting
  // clip), then settle back to idle.
  useEffect(() => {
    const id = setInterval(() => {
      if (transientRef.current) return; // an action is on screen — skip the glance
      clearBlinkFallback();
      setBlink("waiting");
      blinkFallbackRef.current = setTimeout(
        () => setBlink((b) => (b === "waiting" ? null : b)),
        holdMs("waiting"),
      );
    }, GLANCE_EVERY_MS);
    return () => clearInterval(id);
  }, [clearBlinkFallback]);

  useEffect(
    () => () => {
      if (pendingRef.current) releasePending(pendingRef.current);
      clearBlinkFallback();
    },
    [clearBlinkFallback, releasePending],
  );

  const api = useMemo<PirateApi>(
    () => ({ state: transient ?? blink ?? resting, setResting, runWhile, pulse, completeCycle }),
    [transient, blink, resting, runWhile, pulse, completeCycle],
  );

  return <PirateContext.Provider value={api}>{children}</PirateContext.Provider>;
}

export function usePirate(): PirateApi {
  return useContext(PirateContext) ?? noop;
}
