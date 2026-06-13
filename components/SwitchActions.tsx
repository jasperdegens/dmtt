"use client";

// SwitchActions — Phase 6 per-switch CANCEL control (check-in lives in CheckinCard).
//
// Cancel's root authority is the DEVICE-signed CryptoTransfer (Ledger → agent, 1 tinybar,
// memo "DMTT:CANCEL:<topicId>" — CLAUDE.md C1), not this HTTP call. The card guides that
// ceremony: it shows the exact memo to sign, then offers an OPTIONAL fast path — paste the
// resulting transaction id to honor the cancel immediately via POST /api/cancel (the
// executor mirror-verifies it: SUCCESS + memo + Ledger debit). Either way the watcher's
// cancel backstop will independently detect and honor the signed transfer, so pasting the
// id is only to skip the wait. On success the page reloads to the CANCELLED state.

import { useState } from "react";
import { cancelMemo } from "@/lib/types.ts";
import type { SwitchView } from "@/lib/types.ts";

export function SwitchActions({ view, onRefresh }: { view: SwitchView; onRefresh?: () => void }) {
  const [open, setOpen] = useState(false);
  const [ledgerAccountId, setLedgerAccountId] = useState("");
  const [cancelTxId, setCancelTxId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Cancel only applies to a live switch (the page also gates on status === "ACTIVE").
  if (view.status !== "ACTIVE") return null;

  async function submitCancel() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const account = ledgerAccountId.trim();
      const tx = cancelTxId.trim();
      if (!/^\d+\.\d+\.\d+$/.test(account)) {
        throw new Error("Enter the Ledger account id that signed the cancel transfer (0.0.x).");
      }
      if (!tx) {
        throw new Error("Paste the cancel transaction id, or just wait — the watcher backstop will honor the signed transfer.");
      }
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
      // Reflect the terminal state — reload to the CANCELLED view (StatusCard also polls).
      if (onRefresh) onRefresh();
      else if (typeof window !== "undefined") window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-red-900/60 bg-neutral-950 p-5">
      <h2 className="text-lg font-semibold">Cancel switch</h2>
      <p className="mt-1 text-xs text-neutral-400">
        Cancelling tears down the release schedule and shreds the ladder. It is authorized
        by a Ledger-signed transfer, not by this page — the watcher honors the signed memo
        even if you close this tab.
      </p>

      {message ? <p className="mt-3 text-xs text-emerald-300">{message}</p> : null}
      {error ? <p className="mt-3 break-words text-xs text-red-400">{error}</p> : null}

      {!open ? (
        <button
          disabled={busy}
          onClick={() => setOpen(true)}
          className="mt-4 rounded-md border border-red-800 bg-red-950 px-3 py-2 text-sm font-medium text-red-200 disabled:opacity-50"
        >
          Cancel this switch…
        </button>
      ) : (
        <div className="mt-4 space-y-3 rounded-lg border border-neutral-800 p-3">
          <p className="text-xs text-neutral-400">
            1. On your Ledger, sign a 1 tinybar transfer to the agent with this exact memo:
          </p>
          <p className="break-all rounded-md bg-neutral-900 p-2 font-mono text-xs text-neutral-300">
            {cancelMemo(view.topicId)}
          </p>
          <p className="text-xs text-neutral-400">
            2. Paste the transaction id to honor it now (or leave this tab — the backstop
            will pick it up within seconds).
          </p>
          <input
            value={ledgerAccountId}
            onChange={(e) => setLedgerAccountId(e.target.value)}
            placeholder="Ledger account id (0.0.x)"
            className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
          />
          <input
            value={cancelTxId}
            onChange={(e) => setCancelTxId(e.target.value)}
            placeholder="Cancel tx id (0.0.x-secs-nanos)"
            className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
          />
          <button
            disabled={busy}
            onClick={submitCancel}
            className="w-full rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Cancelling…" : "Honor cancel now"}
          </button>
        </div>
      )}
    </div>
  );
}
