"use client";

// CheckinCard — the owner's postponement affordance on the per-switch page.
//
// Check-in is the product invariant (CLAUDE.md / N10): a VERIFIED HUMAN (the World
// nullifier) authorizes each postponement — it cannot be scripted or delegated. This
// card derives the exact check-in request from the public SwitchView (buildCheckinRequest,
// matching the executor's math), runs the reusable World gate over the computed signal,
// then POSTs /api/checkin. On success the soonest rung is burned and release is pushed
// out one interval.
//
// The compact WorldProof stays in the audit event. When IDKit supplied a full v4
// response, we also forward that response so the executor can re-verify against the
// Developer Portal endpoint, whose v4 payload requires responses[].

import { useState } from "react";

import { WorldVerifyCard, type WorldVerified } from "@/components/WorldVerifyCard.tsx";
import { usePirate } from "@/components/scene/PirateContext.tsx";
import { MIN_ACTION_MS } from "@/lib/pirate.ts";
import { buildCheckinRequest, isExhausted } from "@/lib/checkin-client.ts";
import type {
  CheckinInput,
  CheckinArtifacts,
  CheckinResult,
  ExecError,
  SwitchView,
  WorldEnvironment,
  WorldIdkitResponse,
  WorldProof,
} from "@/lib/types.ts";

// Same env derivation the arm wizard (app/page.tsx) uses, so the IDKit environment /
// action env / App-vs-Simulator triple matches (silent failure otherwise — CLAUDE.md).
const PUBLIC_WORLD_ENV =
  process.env.NEXT_PUBLIC_WORLD_ENV ?? process.env.NEXT_PUBLIC_WLD_ENVIRONMENT;
const WORLD_ENV: WorldEnvironment =
  PUBLIC_WORLD_ENV === "staging" ? "staging" : "production";
const WORLD_ACTION = process.env.NEXT_PUBLIC_WORLD_ACTION ?? "check-in";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; result: CheckinResult }
  | { kind: "error"; error: ExecError | { code: string; message: string } };

type CheckinArtifactsWithIdkit = CheckinArtifacts & {
  idkitResponse?: WorldIdkitResponse;
};

export function CheckinCard({
  view,
  onCheckedIn,
}: {
  view: SwitchView;
  /** When provided (the chat live panel), called on a successful check-in so the parent
   *  can refresh the watched view + record it in the transcript — no full-page reload.
   *  When absent (the /s/[topicId] route) the success panel reloads to re-read the view. */
  onCheckedIn?: (result: CheckinResult) => void;
}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const { runWhile } = usePirate();

  // Show the success of the check-in you JUST made, regardless of the now-advanced view
  // (a fresh `view` would otherwise re-derive the next rung and hide this confirmation).
  if (status.kind === "success") {
    const r = status.result;
    return (
      <div className="panel panel--ok p-5">
        <h2 className="panel-title">Checked in.</h2>
        <p className="panel-note mt-2 text-sm">
          Release postponed. You burned the soonest rung and advanced to seq{" "}
          <span className="mono text-[color:var(--cream)]">{r.seq}</span> (rung{" "}
          <span className="mono text-[color:var(--cream)]">{r.liveIdx}</span>).
        </p>
        <p className="panel-note mt-1 text-sm">
          New deadline:{" "}
          <span className="mono text-[color:var(--cream)]">
            {new Date(r.newDeadline).toUTCString()}
          </span>
        </p>
        <button
          type="button"
          onClick={() =>
            onCheckedIn ? setStatus({ kind: "idle" }) : window.location.reload()
          }
          className="btn btn--gold mt-4"
        >
          {onCheckedIn ? "Done" : "Refresh status"}
        </button>
      </div>
    );
  }

  const built = buildCheckinRequest(view);

  // No rung left to advance to (ladder spent) or the switch is terminal — there is
  // nothing to check in. Show the imminent-release notice instead of the gate.
  if (isExhausted(built)) {
    return (
      <div className="panel panel--released p-5">
        <h2 className="panel-title">Check in</h2>
        <p className="mt-2 text-sm text-[color:var(--gold-bright)]">
          No postponements left — release is imminent. The final rung is armed and will
          fire at its deadline; there is no further check-in to make.
        </p>
      </div>
    );
  }

  const { input, newDeadline, newSeq } = built;

  // The World gate fired with a verified nullifier — POST the check-in. We keep the
  // compact proof for CHECKIN_VERIFIED, and include the full IDKit response for the
  // server-side v4 verify pass when the widget supplied one.
  async function handleVerified({ nullifier, idkitResponse }: WorldVerified) {
    setStatus({ kind: "submitting" });
    const proof: WorldProof = {
      proof: "",
      merkle_root: "",
      nullifier_hash: nullifier,
      verification_level: "orb",
    };
    const artifacts: CheckinArtifactsWithIdkit = {
      proof,
      action: WORLD_ACTION,
      ...(idkitResponse ? { idkitResponse } : {}),
    };
    const payload: { input: CheckinInput; artifacts: CheckinArtifactsWithIdkit } = {
      input,
      artifacts,
    };
    // The captain ponders the postponement for at least MIN_ACTION_MS so the beat reads.
    await runWhile(
      "thinking",
      async () => {
        try {
          const res = await fetch("/api/checkin", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            // The route returns { error: ExecError } on a 400 (executor reject), or
            // { error: string } on a 500. Surface the code + message either way.
            const body = (await res.json().catch(() => null)) as
              | { error?: ExecError | string }
              | null;
            const err = body?.error;
            if (err && typeof err === "object") {
              setStatus({ kind: "error", error: err });
            } else {
              setStatus({
                kind: "error",
                error: { code: `HTTP_${res.status}`, message: String(err ?? res.statusText) },
              });
            }
            return;
          }
          const result = (await res.json()) as CheckinResult;
          setStatus({ kind: "success", result });
          onCheckedIn?.(result);
        } catch (e) {
          setStatus({
            kind: "error",
            error: { code: "NETWORK", message: e instanceof Error ? e.message : String(e) },
          });
        }
      },
      MIN_ACTION_MS,
    );
  }

  return (
    <div className="space-y-4">
      <div className="panel p-5">
        <h2 className="panel-title">Check in to postpone</h2>
        <p className="panel-note mt-1 text-sm">
          Prove you&apos;re still here. A verified-human check-in burns the soonest rung
          and pushes release out one interval — to{" "}
          <span className="mono text-[color:var(--cream)]">
            {new Date(newDeadline).toUTCString()}
          </span>{" "}
          (seq <span className="mono text-[color:var(--cream)]">{newSeq}</span>).
        </p>
        {status.kind === "submitting" ? (
          <p className="panel-note mt-3 text-xs">Submitting check-in…</p>
        ) : null}
        {status.kind === "error" ? (
          <p className="mt-3 text-xs text-[color:var(--red)]">
            <span className="mono">{status.error.code}</span>: {status.error.message}
          </p>
        ) : null}
      </div>

      {/* The World gate over the COMPUTED signal — disabled while the POST is in flight
          (a fresh proof is single-use; don't let a double-tap fire two check-ins). */}
      {status.kind === "submitting" ? (
        <div className="panel p-5 opacity-50">
          <p className="panel-note text-sm">Verifying… please wait.</p>
        </div>
      ) : (
        <WorldVerifyCard
          signal={input.signal}
          environment={WORLD_ENV}
          onVerified={handleVerified}
        />
      )}
    </div>
  );
}
