"use client";

// components/scene/PirateStage.tsx — the animated captain, to the right of the chat.
//
// EVERY clip is mounted at once and preloaded, but only the ACTIVE one is shown and played.
// Crucially, a clip is NEVER cut off mid-play: each plays with loop=false, and only when it
// FINISHES does the stage decide what to do next — switch to the latest requested state if it
// changed, or replay the same clip. So state changes always wait for the current animation to
// complete its loop, and every clip always plays the whole way through. (The transient states
// carry a MIN_ACTION_MS floor so a fast action still lingers long enough to reach the boundary
// and be shown.) object-fit:contain guarantees the whole figure shows, never clipped; under
// prefers-reduced-motion it renders the active poster instead.

import { useCallback, useEffect, useRef, useState } from "react";

import { PIRATE_CLIPS, type PirateState } from "@/lib/pirate.ts";
import { usePirate } from "./PirateContext.tsx";
import { useReducedMotion } from "./useReducedMotion.ts";

const STATES = Object.keys(PIRATE_CLIPS) as PirateState[];

export function PirateStage({
  /** Override the captain state; defaults to the shared PirateContext state. */
  state,
  showCaption = true,
}: {
  state?: PirateState;
  showCaption?: boolean;
}) {
  const ctx = usePirate();
  const target = state ?? ctx.state; // the state we WANT to be showing
  const reduced = useReducedMotion();

  // The clip currently on screen. It only changes at a loop boundary (see onEnded).
  const [displayed, setDisplayed] = useState<PirateState>(target);
  const targetRef = useRef(target);
  const displayedRef = useRef(displayed);
  useEffect(() => {
    targetRef.current = target;
  }, [target]);
  useEffect(() => {
    displayedRef.current = displayed;
  }, [displayed]);

  const refs = useRef<Partial<Record<PirateState, HTMLVideoElement | null>>>({});

  // Play the displayed clip from frame 0; pause (and rewind) the rest. The inactive clips
  // stay loaded/decoded so the next switch is instant.
  useEffect(() => {
    if (reduced) return;
    for (const s of STATES) {
      const v = refs.current[s];
      if (!v) continue;
      if (s === displayed) {
        try {
          v.currentTime = 0;
        } catch {
          /* not seekable yet — it'll play from wherever it is */
        }
        void v.play().catch(() => {});
      } else {
        v.pause();
      }
    }
  }, [displayed, reduced]);

  // The ONLY place a transition happens: the displayed clip just finished a full play.
  // Switch to the latest target if it changed; otherwise replay the same clip (loop).
  const onEnded = useCallback(() => {
    const next = targetRef.current;
    const cur = displayedRef.current;
    if (next !== cur) {
      setDisplayed(next); // the play effect starts the new clip from the top
    } else {
      const v = refs.current[cur];
      if (v) {
        try {
          v.currentTime = 0;
        } catch {
          /* ignore */
        }
        void v.play().catch(() => {});
      }
    }
  }, []);

  const clip = PIRATE_CLIPS[displayed];

  return (
    <div className="pirate-zone" aria-hidden="true">
      {reduced ? (
        <img className="pirate-media is-active" src={clip.poster} alt="" draggable={false} />
      ) : (
        STATES.map((s) => (
          <video
            key={s}
            ref={(el) => {
              refs.current[s] = el;
            }}
            className={`pirate-media${s === displayed ? " is-active" : ""}`}
            src={PIRATE_CLIPS[s].src}
            poster={PIRATE_CLIPS[s].poster}
            muted
            playsInline
            preload="auto"
            onEnded={onEnded}
          />
        ))
      )}

      {showCaption ? (
        <span className="pirate-tag">
          <span className="pirate-tag__dot" />
          {clip.caption}
        </span>
      ) : null}
    </div>
  );
}
