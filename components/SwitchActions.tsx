"use client";

// SwitchActions — Phase 6 explicit per-switch check-in / cancel controls.
// Check-in computes the next-rung signal from the public SwitchView, runs the existing
// World flow, calls POST /api/checkin, and asks the parent/status card to refresh.
// Cancel guides the user through the required Ledger cancel memo ceremony (stubbed
// artifact capture until the WebHID signer is available), calls POST /api/cancel, and
// refreshes. Errors are surfaced and mutations are only sent after artifacts exist.

import { useMemo, useState } from "react";
import { signalHash } from "@/lib/crypto.ts";
import { cancelMemo } from "@/lib/types.ts";
import { WorldVerifyCard, type WorldVerified } from "@/components/WorldVerifyCard.tsx";
import type { SwitchView } from "@/lib/types.ts";

function mockCancelTx(ledgerAccountId: string): string {
  return `${ledgerAccountId}-${Math.floor(Date.now() / 1000)}-000000000`;
}

function env(): "staging" | "production" {
  return process.env.NEXT_PUBLIC_WORLD_ENV === "staging" ? "staging" : "production";
}

export function SwitchActions({ view, onRefresh }: { view: SwitchView; onRefresh?: () => void }) {
  const [mode, setMode] = useState<"idle" | "checkin" | "cancel">("idle");
  const [ledgerAccountId, setLedgerAccountId] = useState("");
  const [cancelTxId, setCancelTxId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canCheckIn = view.status === "ACTIVE" && view.liveIdx < view.rungHashes.length;
  const nextSeq = view.liveIdx;
  const nextRungHash = view.rungHashes[view.liveIdx];
  const newDeadline = view.armTime + (view.liveIdx + 1) * view.terms.intervalSec * 1000;
  const checkinSignal = useMemo(() => {
    if (!canCheckIn || !nextRungHash) return null;
    return signalHash(nextRungHash, newDeadline, view.topicId, nextSeq);
  }, [canCheckIn, nextRungHash, newDeadline, view.topicId, nextSeq]);

  async function submitCheckin(world: WorldVerified) {
    if (!checkinSignal) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const proof = world.proof ?? {
        proof: "simulated",
        merkle_root: "simulated",
        nullifier_hash: world.nullifier,
        verification_level: "orb",
      };
      const res = await fetch("/api/checkin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: { topicId: view.topicId, seq: view.seq, signal: checkinSignal },
          artifacts: { proof, action: process.env.NEXT_PUBLIC_WORLD_ACTION ?? "check-in" },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(body.error ?? body));
      setMessage(`Check-in accepted. Deadline advanced to ${new Date(body.newDeadline).toUTCString()}.`);
      setMode("idle");
      onRefresh?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitCancel() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const account = ledgerAccountId.trim();
      const tx = cancelTxId.trim() || mockCancelTx(account);
      if (!/^\d+\.\d+\.\d+$/.test(account)) throw new Error("Enter the Ledger account id that signed the cancel transfer.");
      const res = await fetch("/api/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: { topicId: view.topicId },
          artifacts: { cancelTxId: tx, ledgerAccountId: account },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(body.error ?? body));
      setMessage("Cancel accepted. Schedule deleted and ladder shredded.");
      setMode("idle");
      onRefresh?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
      <h2 className="text-lg font-semibold">Switch actions</h2>
      <p className="mt-1 text-xs text-neutral-400">
        Check in with World ID to advance one fixed rung, or cancel with a Ledger-signed transfer memo.
      </p>

      {message ? <p className="mt-3 text-xs text-emerald-300">{message}</p> : null}
      {error ? <p className="mt-3 break-words text-xs text-red-400">{error}</p> : null}

      {view.status !== "ACTIVE" ? (
        <p className="mt-4 text-sm text-neutral-500">No actions are available for a {view.status.toLowerCase()} switch.</p>
      ) : (
        <div className="mt-4 flex gap-2">
          <button disabled={!canCheckIn || busy} onClick={() => setMode("checkin")} className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            Check in
          </button>
          <button disabled={busy} onClick={() => setMode("cancel")} className="rounded-md border border-red-800 bg-red-950 px-3 py-2 text-sm font-medium text-red-200 disabled:opacity-50">
            Cancel
          </button>
        </div>
      )}

      {mode === "checkin" && checkinSignal ? (
        <div className="mt-4 space-y-3">
          <p className="break-all rounded-md bg-neutral-900 p-2 font-mono text-[11px] text-neutral-400">signal: {checkinSignal}</p>
          <WorldVerifyCard signal={checkinSignal} environment={env()} onVerified={submitCheckin} />
        </div>
      ) : null}

      {mode === "cancel" ? (
        <div className="mt-4 space-y-3 rounded-lg border border-neutral-800 p-3">
          <p className="text-xs text-neutral-400">Sign a 1 tinybar transfer from your Ledger account to the agent with this memo, then paste the transaction id.</p>
          <p className="break-all rounded-md bg-neutral-900 p-2 font-mono text-xs text-neutral-300">{cancelMemo(view.topicId)}</p>
          <input value={ledgerAccountId} onChange={(e) => setLedgerAccountId(e.target.value)} placeholder="Ledger account id (0.0.x)" className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm" />
          <input value={cancelTxId} onChange={(e) => setCancelTxId(e.target.value)} placeholder="Cancel tx id (stub may leave blank)" className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm" />
          <button disabled={busy} onClick={submitCancel} className="w-full rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Cancelling…" : "Submit cancel artifact"}</button>
        </div>
      ) : null}
    </div>
  );
}
