"use client";

// RevealCard — the §4 REVEAL view. Once a switch is RELEASED its watcher posts a
// CAPSULE_PUBLISHED event carrying the fired rung's capsule (decryptable now — its
// drand round has passed). This card runs the PURE reveal pipeline ENTIRELY in the
// browser: capsule → tlock-decrypt → K → fetch ciphertext (HFS proxy / HCS mirror) →
// AES-256-GCM decrypt → plaintext. The plaintext never re-enters any server.

import { useState } from "react";
import { revealMemo, revealDefaults } from "@/lib/reveal.ts";
import type { SwitchView, CapsulePublishedEvent } from "@/lib/types.ts";

/** The published capsule from the (one) CAPSULE_PUBLISHED event, or null pre-release. */
function publishedCapsule(view: SwitchView): string | null {
  for (const e of view.events) {
    if (e.type === "CAPSULE_PUBLISHED") return (e as CapsulePublishedEvent).capsuleB64;
  }
  return null;
}

/** Best-effort: is the decrypted payload printable text, or a binary file? */
function looksTextual(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 512));
  for (const b of sample) {
    if (b === 9 || b === 10 || b === 13) continue; // tab / lf / cr
    if (b < 32 || b === 127) return false;
  }
  return true;
}

export function RevealCard({ view }: { view: SwitchView }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const capsuleB64 = publishedCapsule(view);
  const released = view.status === "RELEASED" && capsuleB64 !== null;

  async function reveal() {
    if (!capsuleB64) return;
    setError(null);
    setBusy(true);
    setText(null);
    setDownloadUrl(null);
    try {
      const plaintext = await revealMemo(revealDefaults(), capsuleB64, view.storage);
      if (looksTextual(plaintext)) {
        setText(new TextDecoder().decode(plaintext));
      } else {
        const blob = new Blob([plaintext as BlobPart], {
          type: "application/octet-stream",
        });
        setDownloadUrl(URL.createObjectURL(blob));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
      <h2 className="text-lg font-semibold">The memo</h2>

      {!released ? (
        <p className="mt-2 text-sm text-neutral-400">
          Sealed. This memo becomes decryptable only after the switch is released —
          when its drand round passes and the watcher publishes the capsule. Check back
          if the owner goes silent.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-emerald-400">
            Released. Decryption happens in your browser — the plaintext never touches a
            server.
          </p>

          {text === null && downloadUrl === null ? (
            <button
              type="button"
              disabled={busy}
              onClick={reveal}
              className="mt-4 w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Decrypting…" : "Reveal the memo"}
            </button>
          ) : null}

          {error ? <p className="mt-3 text-xs text-red-400">{error}</p> : null}

          {text !== null ? (
            <pre className="mt-4 whitespace-pre-wrap break-words rounded-md border border-neutral-800 bg-neutral-900 p-3 text-sm text-neutral-100">
              {text}
            </pre>
          ) : null}

          {downloadUrl !== null ? (
            <a
              href={downloadUrl}
              download={`dmtt-${view.topicId}.bin`}
              className="mt-4 inline-block rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white"
            >
              Download decrypted file
            </a>
          ) : null}
        </>
      )}
    </div>
  );
}
