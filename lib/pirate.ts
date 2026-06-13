// lib/pirate.ts — the captain's animation registry + action-timing helpers (Phase 8).
//
// Pure module (no React, no DOM): a single source of truth mapping each animation
// STATE to its clip + poster, plus the minimum-visible-duration rule so every
// scripted step reads on screen. Imported by the scene components and the chat flow.

/** The six character states Phase 8 requires, each backed by a .webm clip. */
export type PirateState =
  | "idle" // flow is stable / nothing pending
  | "waiting" // user input is needed
  | "thinking" // signed pact is ready; waiting for the final arm action
  | "talking" // a question/card/answer is being rendered
  | "encrypting" // local encryption, storage upload, ladder mint, arm submission
  | "decrypting"; // capsule open + AES reveal

export interface PirateClip {
  /** Looping, muted, transparent VP9 clip under /public. */
  src: string;
  /** Transparent still frame for the poster attribute + reduced-motion fallback. */
  poster: string;
  /** A short caption shown beside the captain so the state reads (and screenshots). */
  caption: string;
}

/** STATE → clip. encrypt.webm/decrypt.webm carry the treasure-chest beats. */
export const PIRATE_CLIPS: Record<PirateState, PirateClip> = {
  idle: { src: "/idle.webm", poster: "/posters/idle.png", caption: "Keeping watch" },
  waiting: { src: "/waiting.webm", poster: "/posters/waiting.png", caption: "Awaiting ye" },
  thinking: { src: "/thinking.webm", poster: "/posters/thinking.png", caption: "Ponderin’…" },
  talking: { src: "/talking.webm", poster: "/posters/talking.png", caption: "Speakin’" },
  encrypting: {
    src: "/encrypt.webm",
    poster: "/posters/encrypt.png",
    caption: "Sealin’ yer secret",
  },
  decrypting: {
    src: "/decrypt.webm",
    poster: "/posters/decrypt.png",
    caption: "Openin’ the chest",
  },
};

/** Ship + waves sprites for the scene (also transparent VP9 with poster fallbacks). */
export const SHIP_CLIP = { src: "/ship.webm", poster: "/posters/ship.png" } as const;
export const WAVES_CLIP = { src: "/waves.webm", poster: "/posters/waves.png" } as const;

/** Phase 8: every scripted chat step and action shows for at least this long so the
 *  matching animation + chat feedback can read. Naturally slower work isn't padded. */
export const MIN_ACTION_MS = 1600;

/** Measured length (ms) of each captain clip. Used as a no-video fallback; normal exits
 *  are driven by PirateStage when the active video reaches a loop boundary. */
export const CLIP_MS: Record<PirateState, number> = {
  idle: 1010,
  waiting: 2470,
  thinking: 2550,
  talking: 2510,
  encrypting: 6170,
  decrypting: 5130,
};

/** Fallback hold time for a state when video loop-boundary events are unavailable. */
export function holdMs(state: PirateState): number {
  return Math.max(MIN_ACTION_MS, CLIP_MS[state] + 150);
}

/** The resting state to fall back to between transient actions: waiting when a card
 *  needs the user, idle when the flow is stable (armed + watching, or terminal). */
export function restingState(opts: { awaitingInput: boolean }): PirateState {
  return opts.awaitingInput ? "waiting" : "idle";
}
