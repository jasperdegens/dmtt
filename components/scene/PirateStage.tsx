"use client";

// components/scene/PirateStage.tsx — the animated captain, to the right of the chat.
//
// EVERY clip is mounted at once and kept looping/decoded, so a state change switches
// INSTANTLY: the active clip is marked .is-active and the CSS does a small crossfade
// (active fades in, the rest fade out then flip to visibility:hidden so they don't leak an
// alpha-matte ghost). object-fit:contain guarantees the whole figure shows, never clipped.
// Under prefers-reduced-motion it renders the active poster instead.
//
// A small caption pill reads out what the captain is doing — it makes the state machine
// legible (and verifiable in screenshots).

import { useEffect, useRef } from "react";

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
  const active = state ?? ctx.state;
  const clip = PIRATE_CLIPS[active];
  const reduced = useReducedMotion();

  // Restart the newly-active clip from frame 0 so it plays from the START — paired with the
  // holdMs floors, encrypt/decrypt (and every glance) get a clean full play, not whatever
  // point of the loop they happened to be at.
  const refs = useRef<Partial<Record<PirateState, HTMLVideoElement | null>>>({});
  useEffect(() => {
    if (reduced) return;
    const v = refs.current[active];
    if (!v) return;
    try {
      v.currentTime = 0;
    } catch {
      /* not seekable yet — it'll just continue looping */
    }
    void v.play?.().catch(() => {});
  }, [active, reduced]);

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
            className={`pirate-media${s === active ? " is-active" : ""}`}
            src={PIRATE_CLIPS[s].src}
            poster={PIRATE_CLIPS[s].poster}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
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
