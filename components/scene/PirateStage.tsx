"use client";

// components/scene/PirateStage.tsx — the animated captain, to the right of the chat.
//
// EVERY clip is mounted at once and crossfaded via the `.is-active` class. That means all
// of the captain's videos are fetched + decoded up front, so changing state never reloads
// a clip (no switch delay) and never flashes a blank frame — the outgoing clip just fades
// to the incoming one. object-fit:contain (CSS) guarantees the whole figure shows, never
// clipped. Under prefers-reduced-motion it renders the active poster instead.
//
// A small caption pill reads out what the captain is doing — it makes the state machine
// legible (and verifiable in screenshots).

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

  return (
    <div className="pirate-zone" aria-hidden="true">
      {reduced ? (
        <img className="pirate-media is-active" src={clip.poster} alt="" draggable={false} />
      ) : (
        STATES.map((s) => (
          <video
            key={s}
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
