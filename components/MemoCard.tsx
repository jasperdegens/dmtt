"use client";

// MemoCard — capture the secret and encrypt it LOCALLY, in the browser.
//
// Hard invariant (CLAUDE.md / CONTRACTS §9): PLAINTEXT and the key K NEVER leave the
// browser — they never enter /api/chat or any server route. Only the ciphertext is
// ever uploaded (by the arm flow), and only its hash is committed on-chain. This card
// encrypts via @/lib/crypto.ts and hands the caller { ciphertextHash, ciphertext,
// storageKind } — K is discarded by encrypt() after the ladder is minted elsewhere.

import { useState } from "react";
import { encrypt, hashCiphertext } from "@/lib/crypto.ts";
import { FAST_PATH_MAX_BYTES, type Hex64 } from "@/lib/types.ts";

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
      // Local AES-256-GCM. K is returned then immediately dropped (the arm flow
      // mints the ladder from it before discarding); we keep only the ciphertext.
      const { ciphertext, key } = await encrypt(plaintext);
      const ciphertextHash = hashCiphertext(ciphertext);
      const storageKind: "hfs" | "hcs" =
        ciphertext.length <= FAST_PATH_MAX_BYTES ? "hfs" : "hcs";
      onCaptured({ ciphertextHash, ciphertext, key, storageKind });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
      <h2 className="text-lg font-semibold">The memo</h2>
      <p className="mt-1 text-xs text-emerald-400">
        🔒 Encrypted in your browser. The plaintext never touches our servers.
      </p>

      <div className="mt-4 flex gap-2 text-sm">
        <button
          type="button"
          onClick={() => setTab("note")}
          className={`rounded-md px-3 py-1.5 ${tab === "note" ? "bg-neutral-200 text-neutral-900" : "bg-neutral-800 text-neutral-300"}`}
        >
          Write a note
        </button>
        <button
          type="button"
          onClick={() => setTab("file")}
          className={`rounded-md px-3 py-1.5 ${tab === "file" ? "bg-neutral-200 text-neutral-900" : "bg-neutral-800 text-neutral-300"}`}
        >
          Drop a file
        </button>
      </div>

      <div className="mt-4">
        {tab === "note" ? (
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="If you are reading this, I have gone quiet…"
            rows={6}
            className="w-full resize-y rounded-md border border-neutral-800 bg-neutral-900 p-3 text-sm text-neutral-100 outline-none focus:border-neutral-600"
          />
        ) : (
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-neutral-300 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-800 file:px-3 file:py-1.5 file:text-neutral-100"
          />
        )}
      </div>

      {error ? <p className="mt-3 text-xs text-red-400">{error}</p> : null}

      <button
        type="button"
        disabled={busy}
        onClick={capture}
        className="mt-4 w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Encrypting…" : "Encrypt locally & continue"}
      </button>
    </div>
  );
}
