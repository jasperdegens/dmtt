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
      // The captain hauls the chest open for the full decrypt clip while the capsule is
      // tlock-opened + AES-decrypted — entirely in the browser.
      const plaintext = await runWhile(
        "decrypting",
        () => revealMemo(revealDefaults(), capsuleB64, view.storage),
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
    <div className={`compose ${released ? "compose--released" : ""}`}>
      <p className="compose__tag">⚱ The memo</p>

      {cancelled ? (
        <p className="compose__lead">
          Stood down — the rungs were shredded to bait. This memo will never be loosed.
          Naught to reveal, matey.
        </p>
      ) : awaitingCapsule ? (
        <p className="compose__lead">
          Released — the capsule’s bein’ hauled up this very moment. Give it a breath, then
          refresh to crack it open.
        </p>
      ) : !released ? (
        <p className="compose__lead">
          Sealed tight. It cracks open only once the switch releases an’ its drand round
          passes. Check back if the owner goes quiet beneath the tides.
        </p>
      ) : (
        <>
          {text === null && downloadUrl === null ? (
            <button type="button" disabled={busy} onClick={reveal} className="btn btn--gold w-full">
              {busy ? "Haulin’ open the chest…" : "⚱ Reveal the memo"}
            </button>
          ) : null}

          {error ? <p className="compose__err">{error}</p> : null}

          {text !== null ? (
            <pre className="thin-scroll max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[color:var(--panel-border)] bg-black/30 p-3 text-sm text-[color:var(--cream)]">
              {text}
            </pre>
          ) : null}

          {downloadUrl !== null ? (
            <a
              href={downloadUrl}
              download={`dmtt-${view.topicId}.bin`}
              className="btn btn--gold inline-block"
            >
              Download decrypted file
            </a>
          ) : null}

          <p className="compose__note">
            Decryption happens in your browser — the plaintext never touches a server.
          </p>
        </>
      )}
    </div>
  );
}
