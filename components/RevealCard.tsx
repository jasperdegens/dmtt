"use client";

// RevealCard — the §4 REVEAL view. Once a switch is RELEASED its watcher posts a
// CAPSULE_PUBLISHED event carrying the fired rung's capsule (decryptable now — its
// drand round has passed). This card runs the PURE reveal pipeline ENTIRELY in the
// browser: capsule → tlock-decrypt → K → fetch ciphertext (HFS proxy / HCS mirror) →
// AES-256-GCM decrypt → plaintext. The plaintext never re-enters any server.

import { useState } from "react";
import { revealMemo, revealDefaults } from "@/lib/reveal.ts";
import type { SwitchView, CapsulePublishedEvent } from "@/lib/types.ts";
import { usePirate } from "./scene/PirateContext.tsx";
import { MIN_ACTION_MS } from "@/lib/pirate.ts";

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
  const { runWhile } = usePirate();

  const capsuleB64 = publishedCapsule(view);
  const released = view.status === "RELEASED" && capsuleB64 !== null;
  // RELEASED but the watcher hasn't posted CAPSULE_PUBLISHED yet — distinguishable
  // from a still-sealed (ACTIVE) switch: release HAS fired, the capsule is moments away.
  const awaitingCapsule = view.status === "RELEASED" && capsuleB64 === null;
  // Terminal-not-released: a cancelled switch never releases — its rungs are shredded.
  const cancelled = view.status === "CANCELLED";

  async function reveal() {
    if (!capsuleB64) return;
    setError(null);
    setBusy(true);
    setText(null);
    setDownloadUrl(null);
    try {
      // The captain hauls open the chest for at least MIN_ACTION_MS while the capsule
      // is tlock-opened + AES-decrypted — entirely in the browser.
      const plaintext = await runWhile(
        "decrypting",
        () => revealMemo(revealDefaults(), capsuleB64, view.storage),
        MIN_ACTION_MS,
      );
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
    <div className={`panel p-5 ${released ? "panel--released" : ""}`}>
      <h2 className="panel-title">The memo</h2>

      {cancelled ? (
        <p className="panel-note mt-2 text-sm">
          Cancelled. The owner stood the switch down — its rungs were shredded and this
          memo will never be released. Nothing to reveal.
        </p>
      ) : awaitingCapsule ? (
        <p className="mt-2 text-sm text-[color:var(--gold-bright)]">
          Released — awaiting the capsule. Release has been authorized; the watcher is
          publishing the decryptable capsule now. Refresh in a moment to reveal the memo.
        </p>
      ) : !released ? (
        <p className="panel-note mt-2 text-sm">
          Sealed. This memo becomes decryptable only after the switch is released —
          when its drand round passes and the watcher publishes the capsule. Check back
          if the owner goes silent.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-[color:var(--gold-bright)]">
            Released. Decryption happens in your browser — the plaintext never touches a
            server.
          </p>

          {text === null && downloadUrl === null ? (
            <button type="button" disabled={busy} onClick={reveal} className="btn btn--gold mt-4 w-full">
              {busy ? "Hauling open the chest…" : "⚱ Reveal the memo"}
            </button>
          ) : null}

          {error ? <p className="mt-3 text-xs text-[color:var(--red)]">{error}</p> : null}

          {text !== null ? (
            <pre className="thin-scroll mt-4 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[color:var(--panel-border)] bg-black/30 p-3 text-sm text-[color:var(--cream)]">
              {text}
            </pre>
          ) : null}

          {downloadUrl !== null ? (
            <a
              href={downloadUrl}
              download={`dmtt-${view.topicId}.bin`}
              className="btn btn--gold mt-4 inline-block"
            >
              Download decrypted file
            </a>
          ) : null}
        </>
      )}
    </div>
  );
}
