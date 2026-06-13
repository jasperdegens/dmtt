"use client";

// components/scene/PirateStage.tsx — the animated captain, lower-right of the scene.
//
// Renders the clip for the current PirateState (driven by PirateContext). The clips
// are transparent VP9 with alpha, looped + muted (no audio). On state change the
// <video> remounts (key=src) and fades in over its own poster frame, so the captain
// is never blank. Under prefers-reduced-motion it renders the static poster instead.
//
// A small caption pill reads out what the captain is doing — it makes the state
// machine legible (and verifiable in screenshots).

import { PIRATE_CLIPS, type PirateState } from "@/lib/pirate.ts";
import { usePirate } from "./PirateContext.tsx";
import { useReducedMotion } from "./useReducedMotion.ts";

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
        <img className="pirate-media" src={clip.poster} alt="" draggable={false} />
      ) : (
        <video
          key={clip.src}
          className="pirate-media pirate-media--fade"
          src={clip.src}
          poster={clip.poster}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
        />
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
