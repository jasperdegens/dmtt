"use client";

// components/scene/SceneBackground.tsx — the stormy harbour behind everything (z-0).
//
// Layers (back to front, all inside the fixed .stage): sky/sea gradient → moon glow →
// drifting cloud bank → back wave layer → the darkened galleon → lightning flash →
// vignette. The galleon + back wave are real transparent VP9 sprites. The lightning
// overlay illuminates the ship + back wave in sync; WavesForeground carries a twin
// overlay so the foreground wave flashes on the same beat. Reduced motion freezes all
// of it (the ship/wave posters stand in via WaveLayer + the <video> poster frame).

import { SHIP_CLIP } from "@/lib/pirate.ts";
import { WaveLayer } from "./WaveLayer.tsx";
import { useReducedMotion } from "./useReducedMotion.ts";

export function SceneBackground() {
  const reduced = useReducedMotion();

  return (
    <div className="stage" aria-hidden="true">
      <div className="sky" />
      <div className="moon" />
      <div className="clouds" />

      {/* back wave — behind the ship */}
      <WaveLayer variant="back" seek={0} />

      {/* the galleon */}
      {reduced ? (
        <img className="ship" src={SHIP_CLIP.poster} alt="" draggable={false} />
      ) : (
        <video
          className="ship"
          src={SHIP_CLIP.src}
          poster={SHIP_CLIP.poster}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
        />
      )}

      {!reduced ? <div className="lightning" /> : null}
      <div className="vignette" />
    </div>
  );
}
