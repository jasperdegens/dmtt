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
// PHASE-3 SCOPE: World verify flags are OFF (executors don't re-verify proofs yet), so
// we forward a PLACEHOLDER WorldProof carrying only the verified nullifier_hash. The
// REAL IDKit proof (proof / merkle_root) must be forwarded here once verifyCheckinProof
// flips on in Phase 5 — see the comment at handleVerified(). We do NOT pretend to verify
// what we aren't: the placeholder is explicit, not a silent stub.

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

export function CheckinCard({ view }: { view: SwitchView }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

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

  // The World gate fired with a verified nullifier — POST the check-in. In Phase 3
  // (verifyCheckinProof OFF) we forward a placeholder proof carrying only the nullifier;
  // the executor doesn't re-verify it. PHASE 5 (flags ON): forward the REAL IDKit
  // response/proof here instead so /api/v4/verify can re-check it — the placeholder MUST
  // be replaced, not extended.
  async function handleVerified({ nullifier }: WorldVerified) {
    setStatus({ kind: "submitting" });
    const proof: WorldProof = {
      proof: "", // Phase 5: real IDKit proof.
      merkle_root: "", // Phase 5: real IDKit merkle_root.
      nullifier_hash: nullifier,
      verification_level: "orb",
    };
    const artifacts: CheckinArtifacts = { proof, action: WORLD_ACTION };
    const payload: { input: CheckinInput; artifacts: CheckinArtifacts } = {
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
    } catch (e) {
      setStatus({
        kind: "error",
        error: { code: "NETWORK", message: e instanceof Error ? e.message : String(e) },
      });
    }
  }

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
          onClick={() => window.location.reload()}
          className="mt-4 inline-block rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white"
        >
          Refresh status
        </button>
      </div>
    );
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
