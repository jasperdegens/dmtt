"use client";

// WorldVerifyCard — the World ID human gate (CONTRACTS §9, World ID 4.0).
//
// The World nullifier authorizes arm-enrollment and check-in postponements; it CANNOT
// be scripted or delegated (product invariant — no World AgentKit). This card runs the
// IDKit flow against the configured app, then forwards the proof to the SERVER-ONLY
// verify route (POST /api/world/verify) which re-signs/re-checks it; on success the
// route returns the verified nullifier. The signing_key stays server-side — only the
// public NEXT_PUBLIC_WORLD_* config reaches the client.
//
// IDKit v4's rp_context must be signed by the backend (POST /api/world/rp-context); we
// fetch it before opening the widget. When World isn't configured (no app id, or a dev
// run) the clearly-labeled "simulate" button stands in so the wizard still flows — it
// emits a deterministic, contract-valid nullifier for local testing only.

import { useState } from "react";
import {
  IDKitRequestWidget,
  orbLegacy,
  type IDKitResult,
  type RpContext,
} from "@worldcoin/idkit";
import type {
  Nullifier,
  RpContextResponse,
  WorldIdkitResponse,
  WorldEnvironment,
  WorldVerifyResponse,
} from "@/lib/types.ts";

export interface WorldVerified {
  nullifier: Nullifier;
  idkitResponse?: WorldIdkitResponse;
}

const APP_ID = process.env.NEXT_PUBLIC_WORLD_APP_ID ?? "";
const ACTION = process.env.NEXT_PUBLIC_WORLD_ACTION ?? "check-in";

function WorldIcon() {
  return (
    <svg
      className="world-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="8.25" />
      <path d="M3.75 12h16.5" />
      <path d="M12 3.75c2.35 2.2 3.55 4.95 3.55 8.25S14.35 18.05 12 20.25" />
      <path d="M12 3.75C9.65 5.95 8.45 8.7 8.45 12s1.2 6.05 3.55 8.25" />
    </svg>
  );
}

export function WorldVerifyCard({
  signal,
  environment,
  onVerified,
}: {
  /** The bound signal (arm-enroll or check-in signalHash). */
  signal: string;
  /** Must match WORLD_ENV and the action's Portal environment. */
  environment: WorldEnvironment;
  onVerified: (v: WorldVerified) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rpContext, setRpContext] = useState<RpContextResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configured = APP_ID.startsWith("app_");

  // Fetch the backend-signed rp_context, then open the IDKit widget.
  async function startVerify() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/world/rp-context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signal }),
      });
      if (!res.ok) throw new Error(`rp-context failed (${res.status})`);
      setRpContext((await res.json()) as RpContextResponse);
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // The widget succeeded — forward the proof to the server verify route.
  async function handleSuccess(result: IDKitResult) {
    setOpen(false);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/world/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idkitResponse: result, action: ACTION, signal, environment }),
      });
      const body = (await res.json()) as WorldVerifyResponse;
      if (!body.ok || !body.nullifier) {
        throw new Error(body.detail ?? "verification rejected");
      }
      onVerified({
        nullifier: body.nullifier,
        idkitResponse: result as unknown as WorldIdkitResponse,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Dev-only stand-in so the wizard flows when World isn't configured.
  function simulate() {
    onVerified({
      nullifier: "12345678901234567890123456789012345678901234567890",
    });
  }

  return (
    <div className="compose">
      {error ? <p className="compose__err">{error}</p> : null}

      {configured ? (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={startVerify}
            className="btn btn--gold w-full"
          >
            <WorldIcon />
            <span>{busy ? "Verifying..." : "Prove I’m a living soul"}</span>
          </button>

          {rpContext ? (
            <IDKitRequestWidget
              open={open}
              onOpenChange={setOpen}
              app_id={APP_ID as `app_${string}`}
              action={ACTION}
              rp_context={rpContext as unknown as RpContext}
              allow_legacy_proofs={true}
              environment={environment}
              preset={orbLegacy({ signal })}
              onSuccess={handleSuccess}
              onError={(code) => setError(String(code))}
            />
          ) : null}
        </>
      ) : (
        <button type="button" onClick={simulate} className="btn btn--ghost w-full">
          Simulate World ID (dev — not configured)
        </button>
      )}
    </div>
  );
}
