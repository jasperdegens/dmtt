// lib/pirate.ts — the captain's animation registry + action-timing helpers (Phase 8).
//
// Pure module (no React, no DOM): a single source of truth mapping each animation
// STATE to its clip + poster, plus the minimum-visible-duration rule so every
// scripted step reads on screen. Imported by the scene components and the chat flow.

/** The six character states Phase 8 requires, each backed by a .webm clip. */
export type PirateState =
  | "idle" // flow is stable / nothing pending
  | "waiting" // user input is needed
  | "thinking" // async work in flight (network, machine advance)
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
export const MIN_ACTION_MS = 2000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Run `work`, but don't resolve before `ms` has elapsed — a floor, never a delay
 *  added on top of slow work. Returns whatever `work` returns (and still rejects if
 *  it does, only after the floor, so the working animation never flickers away early). */
export async function withMinDuration<T>(
  work: () => Promise<T>,
  ms: number = MIN_ACTION_MS,
): Promise<T> {
  const floor = sleep(ms);
  try {
    const result = await work();
    await floor;
    return result;
  } catch (err) {
    await floor;
    throw err;
  }
}

/** The resting state to fall back to between transient actions: waiting when a card
 *  needs the user, idle when the flow is stable (armed + watching, or terminal). */
export function restingState(opts: { awaitingInput: boolean }): PirateState {
  return opts.awaitingInput ? "waiting" : "idle";
}
