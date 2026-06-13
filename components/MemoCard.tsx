"use client";

// MemoCard — capture the secret and encrypt it LOCALLY, in the browser.
//
// Hard invariant (CLAUDE.md / CONTRACTS §9): PLAINTEXT and the key K NEVER leave the
// browser — they never enter /api/chat or any server route. Only the ciphertext is
// ever uploaded (by the arm flow), and only its hash is committed on-chain. This card
// encrypts via @/lib/crypto.ts and hands the caller { ciphertextHash, ciphertext,
// storageKind } — K is discarded by encrypt() after the ladder is minted elsewhere.
//
// Phase 8: encryption drives the captain's "encrypting" beat (he seals your secret in
// the chest) for at least MIN_ACTION_MS so it reads.

import { useState } from "react";
import { encrypt, hashCiphertext } from "@/lib/crypto.ts";
import { FAST_PATH_MAX_BYTES, type Hex64 } from "@/lib/types.ts";
import { BusyLabel } from "./BusyLabel.tsx";
import { usePirate } from "./scene/PirateContext.tsx";

// Storage ceiling: HFS files cap at 1 MB and the HCS large path is scoped to ~1 MB
// too (CLAUDE.md C2). Guard the plaintext just under that so the ciphertext + the
// AES-GCM overhead still fit — a clear message beats a failed upload mid-arm.
const MAX_PLAINTEXT_BYTES = 1_000_000;

export interface MemoCaptured {
  ciphertextHash: Hex64;
  ciphertext: Uint8Array;
  /** The ephemeral AES key K — browser-memory ONLY (mint the ladder, then discard). */
  key: Uint8Array;
  /** Which storage medium the size implies (HFS fast path ≤4 KB, else HCS). */
  storageKind: "hfs" | "hcs";
}

type Tab = "note" | "file";

export function MemoCard({
  onCaptured,
}: {
  onCaptured: (captured: MemoCaptured) => void;
}) {
  const [tab, setTab] = useState<Tab>("note");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { runWhile } = usePirate();

  async function capture() {
    setError(null);
    setBusy(true);
    try {
      let plaintext: Uint8Array;
      if (tab === "note") {
        if (!note.trim()) throw new Error("Write something first.");
        plaintext = new TextEncoder().encode(note);
      } else {
        if (!file) throw new Error("Choose a file first.");
        plaintext = new Uint8Array(await file.arrayBuffer());
      }
      // Storage ceiling guard (CLAUDE.md C2): HFS files cap at 1 MB and the HCS large
      // path is scoped to ~1 MB too. Reject oversized payloads up front with a clear
      // message — a failed upload mid-arm (after Ledger sign + ladder mint) is worse.
      if (plaintext.length > MAX_PLAINTEXT_BYTES) {
        throw new Error(
          `Too large: ${(plaintext.length / 1_000_000).toFixed(2)} MB exceeds the ${(MAX_PLAINTEXT_BYTES / 1_000_000).toFixed(0)} MB limit.`,
        );
      }
      // Local AES-256-GCM. K is returned then immediately dropped (the arm flow
      // mints the ladder from it before discarding); we keep only the ciphertext.
      // The captain seals the chest through the FULL encrypt clip while it happens.
      const captured = await runWhile(
        "encrypting",
        async () => {
          const { ciphertext, key } = await encrypt(plaintext);
          const ciphertextHash = hashCiphertext(ciphertext);
          const storageKind: "hfs" | "hcs" =
            ciphertext.length <= FAST_PATH_MAX_BYTES ? "hfs" : "hcs";
          return { ciphertextHash, ciphertext, key, storageKind } as MemoCaptured;
        },
      );
      onCaptured(captured);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="compose">
      <div className="compose__chips">
        <button type="button" onClick={() => setTab("note")} className={tab === "note" ? "qchip qchip--active" : "qchip"}>
          ✍ Write a note
        </button>
        <button type="button" onClick={() => setTab("file")} className={tab === "file" ? "qchip qchip--active" : "qchip"}>
          📎 Drop a file
        </button>
      </div>

      {tab === "note" ? (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="If you are reading this, I have gone quiet…"
          rows={4}
          className="field resize-y"
        />
      ) : (
        <input
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="field file:mr-3 file:rounded-md file:border-0 file:bg-[color:var(--gold-deep)] file:px-3 file:py-1.5 file:text-[#2a1810]"
        />
      )}

      <p className="compose__tag">🔒 Sealed in your browser · the plaintext never leaves</p>

      {error ? <p className="compose__err">{error}</p> : null}

      <button
        type="button"
        disabled={busy}
        aria-busy={busy}
        onClick={capture}
        className="btn btn--gold w-full"
      >
        {busy ? <BusyLabel>Sealin' the chest</BusyLabel> : "Seal it ⚓"}
      </button>
    </div>
  );
}
