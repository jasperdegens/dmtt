"use client";

// components/scene/WavesForeground.tsx — the foreground sea (z-30) + its lightning twin.
//
// The second wave layer rides in front of the lower scene, offset from the back layer
// (different sway + a half-loop time seek) so the two never move in lockstep. The
// twin lightning overlay (z-31) flashes on the SAME schedule as the stage overlay, so
// the foreground surf brightens together with the ship. Both are pointer-events:none
// and sit below the interactive panels/controls, so they never hide text or buttons.

import { WaveLayer } from "./WaveLayer.tsx";
import { useReducedMotion } from "./useReducedMotion.ts";

export function WavesForeground() {
  const reduced = useReducedMotion();
  return (
    <>
      <WaveLayer variant="front" seek={1.8} rate={0.8} />
      {!reduced ? <div className="lightning--front" /> : null}
    </>
  );
}
