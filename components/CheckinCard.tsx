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

  // Show the success of the check-in you JUST made, regardless of the now-advanced view
  // (a fresh `view` would otherwise re-derive the next rung and hide this confirmation).
  if (status.kind === "success") {
    const r = status.result;
    return (
      <div className="rounded-xl border border-emerald-900 bg-neutral-950 p-5">
        <h2 className="text-lg font-semibold text-emerald-300">Checked in.</h2>
        <p className="mt-2 text-sm text-neutral-400">
          Release postponed. You burned the soonest rung and advanced to seq{" "}
          <span className="font-mono text-neutral-200">{r.seq}</span> (rung{" "}
          <span className="font-mono text-neutral-200">{r.liveIdx}</span>).
        </p>
        <p className="mt-1 text-sm text-neutral-400">
          New deadline:{" "}
          <span className="font-mono text-neutral-200">
            {new Date(r.newDeadline).toUTCString()}
          </span>
        </p>
        <button
          type="button"
          onClick={() =>
            onCheckedIn ? setStatus({ kind: "idle" }) : window.location.reload()
          }
          className="mt-4 inline-block rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white"
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
      <div className="rounded-xl border border-amber-900 bg-neutral-950 p-5">
        <h2 className="text-lg font-semibold">Check in</h2>
        <p className="mt-2 text-sm text-amber-300">
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
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
        <h2 className="text-lg font-semibold">Check in to postpone</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Prove you&apos;re still here. A verified-human check-in burns the soonest rung
          and pushes release out one interval — to{" "}
          <span className="font-mono text-neutral-300">
            {new Date(newDeadline).toUTCString()}
          </span>{" "}
          (seq <span className="font-mono text-neutral-300">{newSeq}</span>).
        </p>
        {status.kind === "submitting" ? (
          <p className="mt-3 text-xs text-neutral-400">Submitting check-in…</p>
        ) : null}
        {status.kind === "error" ? (
          <p className="mt-3 text-xs text-red-400">
            <span className="font-mono">{status.error.code}</span>: {status.error.message}
          </p>
        ) : null}
      </div>

      {/* The World gate over the COMPUTED signal — disabled while the POST is in flight
          (a fresh proof is single-use; don't let a double-tap fire two check-ins). */}
      {status.kind === "submitting" ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5 opacity-50">
          <p className="text-sm text-neutral-400">Verifying… please wait.</p>
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
