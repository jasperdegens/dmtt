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
// fetch it before opening the request flow. When World isn't configured (no app id, or a
// dev run) the clearly-labeled "simulate" button stands in so the wizard still flows — it
// emits a deterministic, contract-valid nullifier for local testing only.

import { useEffect, useRef, useState } from "react";
import {
  orbLegacy,
  useIDKitRequest,
  type IDKitResult,
  type RpContext,
} from "@worldcoin/idkit";
import QRCode from "qrcode";
import { BusyLabel } from "@/components/BusyLabel.tsx";
import { WorldIcon } from "@/components/WorldIcon.tsx";
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

interface WorldRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appId: `app_${string}`;
  action: string;
  rpContext: RpContextResponse;
  signal: string;
  environment: WorldEnvironment;
  onSuccess: (result: IDKitResult) => void | Promise<void>;
  onError: (message: string) => void;
}

function WorldRequestDialog({
  open,
  onOpenChange,
  appId,
  action,
  rpContext,
  signal,
  environment,
  onSuccess,
  onError,
}: WorldRequestDialogProps) {
  const {
    open: openRequest,
    reset,
    connectorURI,
    isAwaitingUserConnection,
    isAwaitingUserConfirmation,
    isError,
    isSuccess,
    result,
    errorCode,
  } = useIDKitRequest({
    app_id: appId,
    action,
    rp_context: rpContext as unknown as RpContext,
    allow_legacy_proofs: true,
    environment,
    preset: orbLegacy({ signal }),
  });
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const handledResultRef = useRef<IDKitResult | null>(null);
  const handledErrorRef = useRef<string | null>(null);
  // Tracks the previous `open` so the dedup latches are re-armed ONCE per request
  // session — on the closed→open edge — and never on close.
  const wasOpenRef = useRef(false);

  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (open) {
      // A fresh request session: allow exactly one success/error to be handled.
      // We deliberately do NOT re-arm these latches on close: handleSuccess flips
      // `open` to false as its first act, and re-arming there lets the success
      // effect fire a SECOND time (onSuccess is an unstable dep, so it re-runs
      // after the close re-render) — duplicating the transcript line.
      if (justOpened) {
        handledResultRef.current = null;
        handledErrorRef.current = null;
      }
      openRequest();
      return;
    }
    setQrDataUrl(null);
    reset();
  }, [open, openRequest, reset]);

  useEffect(() => {
    let cancelled = false;
    setQrDataUrl(null);

    if (!connectorURI || environment === "staging") return;

    void QRCode.toDataURL(connectorURI, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 224,
      color: { dark: "#111827", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) onError("QR generation failed");
      });

    return () => {
      cancelled = true;
    };
  }, [connectorURI, environment, onError]);

  useEffect(() => {
    if (!isSuccess || !result || handledResultRef.current === result) return;
    handledResultRef.current = result;
    void onSuccess(result);
  }, [isSuccess, onSuccess, result]);

  useEffect(() => {
    const nextError = errorCode ? String(errorCode) : null;
    if (!isError || !nextError || handledErrorRef.current === nextError) return;
    handledErrorRef.current = nextError;
    onError(nextError);
  }, [errorCode, isError, onError]);

  if (!open) return null;

  const simulatorUrl =
    environment === "staging" && connectorURI
      ? `https://simulator.worldcoin.org?connect_url=${encodeURIComponent(connectorURI)}`
      : null;
  const statusText = isAwaitingUserConfirmation
    ? "Waiting for confirmation..."
    : isAwaitingUserConnection
      ? "Waiting for connection..."
      : "Preparing request...";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-950 p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-white">World ID</h3>
            <p className="mt-1 text-xs text-neutral-400">{statusText}</p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-900"
          >
            Cancel
          </button>
        </div>

        <div className="mt-5 flex min-h-60 items-center justify-center rounded-lg border border-neutral-800 bg-white p-4">
          {environment === "staging" ? (
            simulatorUrl ? (
              <a
                href={simulatorUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
              >
                Open World Simulator
              </a>
            ) : (
              <p className="text-sm text-neutral-700">Preparing simulator...</p>
            )
          ) : qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="World ID QR code"
              className="h-56 w-56"
            />
          ) : (
            <p className="text-sm text-neutral-700">Preparing QR code...</p>
          )}
        </div>
      </div>
    </div>
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
  // Latches the verify+notify path so a single verified result drives exactly ONE
  // onVerified call — even if the IDKit dialog fires its success effect more than
  // once. Released only on a verify failure (below) so the user can retry.
  const verifyingRef = useRef(false);

  const configured = APP_ID.startsWith("app_");

  // Fetch the backend-signed rp_context, then open the IDKit request flow.
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

  // The request succeeded — forward the proof to the server verify route.
  async function handleSuccess(result: IDKitResult) {
    // Latch SYNCHRONOUSLY (before any await) so a re-fired success effect can't
    // start a second verify and call onVerified twice — the cause of the doubled
    // "Verified… / sign on yer Ledger" transcript lines.
    if (verifyingRef.current) return;
    verifyingRef.current = true;
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
      // Success: keep the latch closed — the chat advances past WORLD and this card
      // unmounts; a stray re-fire must not re-notify.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      verifyingRef.current = false; // verify failed — allow another attempt
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
            aria-busy={busy}
            onClick={startVerify}
            className="btn btn--gold w-full"
          >
            <WorldIcon />
            {busy ? <BusyLabel>Verifying</BusyLabel> : <span>Prove I’m a living soul</span>}
          </button>

          {rpContext ? (
            <WorldRequestDialog
              open={open}
              onOpenChange={setOpen}
              appId={APP_ID as `app_${string}`}
              action={ACTION}
              rpContext={rpContext}
              signal={signal}
              environment={environment}
              onSuccess={handleSuccess}
              onError={setError}
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
