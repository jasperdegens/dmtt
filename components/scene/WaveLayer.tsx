"use client";

// components/scene/WaveLayer.tsx — one darkened wave video covering the lower band.
//
// The same clip is used twice: a "back" layer behind the ship and a "front" layer in
// front of lower content. They're kept out of lockstep three ways — a different sway
// (CSS per variant, plus the front layer is mirrored), an initial time offset (`seek`),
// AND a different playback rate (`rate`) so the crests drift apart continuously even
// from one shared clip. Reduced motion swaps in the static poster.

import { useEffect, useRef } from "react";
import { WAVES_CLIP } from "@/lib/pirate.ts";
import { useReducedMotion } from "./useReducedMotion.ts";

export function WaveLayer({
  variant,
  /** Seconds to skip into the loop so this layer starts out of phase with the other. */
  seek = 0,
  /** Playback rate ≠ the other layer's so the two never settle into lockstep. */
  rate = 1,
}: {
  variant: "back" | "front";
  seek?: number;
  rate?: number;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const reduced = useReducedMotion();

  // Apply rate + phase offset imperatively. Setting these via React media-event props
  // races the browser firing the event before hydration (esp. for a cached clip), so
  // we set them in an effect and also catch the already-loaded case via readyState.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.playbackRate = rate;
    const applySeek = () => {
      if (seek > 0 && Number.isFinite(v.duration) && v.duration > 0.1) {
        try {
          v.currentTime = Math.min(seek, v.duration - 0.05);
        } catch {
          /* not seekable yet — the loadedmetadata handler will retry */
        }
      }
    };
    if (v.readyState >= 1) applySeek(); // HAVE_METADATA: duration is known
    v.addEventListener("loadedmetadata", applySeek);
    return () => v.removeEventListener("loadedmetadata", applySeek);
  }, [rate, seek]);

  if (reduced) {
    return (
      <img
        className={`wave wave--${variant}`}
        src={WAVES_CLIP.poster}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    );
  }

  return (
    <video
      ref={ref}
      className={`wave wave--${variant}`}
      src={WAVES_CLIP.src}
      poster={WAVES_CLIP.poster}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      aria-hidden="true"
    />
  );
}
