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

      {/* jagged lightning bolts in the sky, flashing on the same beats as the glow */}
      {!reduced ? (
        <svg
          className="bolts"
          viewBox="0 0 1000 600"
          preserveAspectRatio="xMidYMin slice"
          aria-hidden="true"
        >
          <path
            className="bolt bolt--1"
            d="M 175 -20 L 150 95 L 188 108 L 138 215 L 176 228 L 120 340 L 150 348 L 96 470"
          />
          <path
            className="bolt bolt--2"
            d="M 832 -20 L 866 86 L 824 100 L 884 205 L 838 220 L 900 330 L 862 340 L 912 452"
          />
          <path className="bolt bolt--3" d="M 520 -20 L 498 120 L 532 132 L 486 270 L 520 282 L 470 410" />
        </svg>
      ) : null}

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
