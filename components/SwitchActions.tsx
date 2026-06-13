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
import { usePirate } from "./scene/PirateContext.tsx";
import { MIN_ACTION_MS } from "@/lib/pirate.ts";

export function SwitchActions({ view, onRefresh }: { view: SwitchView; onRefresh?: () => void }) {
  const [open, setOpen] = useState(false);
  const [ledgerAccountId, setLedgerAccountId] = useState("");
  const [cancelTxId, setCancelTxId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { runWhile } = usePirate();

  // Cancel only applies to a live switch (the page also gates on status === "ACTIVE").
  if (view.status !== "ACTIVE") return null;

  async function submitCancel() {
    setError(null);
    setMessage(null);
    const account = ledgerAccountId.trim();
    const tx = cancelTxId.trim();
    if (!/^\d+\.\d+\.\d+$/.test(account)) {
      setError("Enter the Ledger account id that signed the cancel transfer (0.0.x).");
      return;
    }
    if (!tx) {
      setError(
        "Paste the cancel transaction id, or just wait — the watcher backstop will honor the signed transfer.",
      );
      return;
    }
    setBusy(true);
    try {
      await runWhile(
        "thinking",
        async () => {
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
          // Reflect the terminal state — reload to CANCELLED (StatusCard also polls).
          if (onRefresh) onRefresh();
          else if (typeof window !== "undefined") window.location.reload();
        },
        MIN_ACTION_MS,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel panel--danger p-5">
      <h2 className="panel-title">Cancel switch</h2>
      <p className="panel-note mt-1 text-xs">
        Cancelling tears down the release schedule and shreds the ladder. It is authorized
        by a Ledger-signed transfer, not by this page — the watcher honors the signed memo
        even if you close this tab.
      </p>

      {message ? <p className="mt-3 text-xs text-[color:#7ce0a0]">{message}</p> : null}
      {error ? <p className="mt-3 break-words text-xs text-[color:var(--red)]">{error}</p> : null}

      {!open ? (
        <button disabled={busy} onClick={() => setOpen(true)} className="btn btn--danger mt-4">
          Cancel this switch…
        </button>
      ) : (
        <div className="mt-4 space-y-3 rounded-lg border border-[color:var(--panel-border)] p-3">
          <p className="panel-note text-xs">
            1. On your Ledger, sign a 1 tinybar transfer to the agent with this exact memo:
          </p>
          <p className="mono break-all rounded-md border border-[color:var(--panel-border)] bg-black/30 p-2 text-xs text-[color:var(--gold-bright)]">
            {cancelMemo(view.topicId)}
          </p>
          <p className="panel-note text-xs">
            2. Paste the transaction id to honor it now (or leave this tab — the backstop
            will pick it up within seconds).
          </p>
          <input
            value={ledgerAccountId}
            onChange={(e) => setLedgerAccountId(e.target.value)}
            placeholder="Ledger account id (0.0.x)"
            className="field"
          />
          <input
            value={cancelTxId}
            onChange={(e) => setCancelTxId(e.target.value)}
            placeholder="Cancel tx id (0.0.x-secs-nanos)"
            className="field"
          />
          <button disabled={busy} onClick={submitCancel} className="btn btn--danger w-full">
            {busy ? "Cancelling…" : "Honor cancel now"}
          </button>
        </div>
      )}
    </div>
  );
}
