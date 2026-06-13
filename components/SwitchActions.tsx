"use client";

// SwitchActions — Phase 6 per-switch CANCEL control (check-in lives in CheckinCard).
//
// Cancel's root authority is the DEVICE-signed CryptoTransfer (Ledger → agent, 1 tinybar,
// memo "DMTT:CANCEL:<topicId>" — CLAUDE.md C1), not this HTTP call. Two ways to produce it:
//   • One-click on the Ledger (useLedgerHedera): connect → sign the 1-tinybar transfer →
//     it is relayed on-chain, then we honor it via POST /api/cancel.
//   • Paste a transaction id you signed elsewhere (the manual fallback).
// Either way the executor mirror-verifies it (SUCCESS + memo + Ledger debit), and the
// watcher's cancel backstop honors the signed transfer independently — so honoring here
// only skips the wait. On success the page reloads to the CANCELLED state.

import { useState } from "react";
import { cancelMemo } from "@/lib/types.ts";
import type { SwitchView } from "@/lib/types.ts";
import { useLedgerHedera } from "./useLedgerHedera.ts";

export function SwitchActions({ view, onRefresh }: { view: SwitchView; onRefresh?: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualAccount, setManualAccount] = useState("");
  const [manualTx, setManualTx] = useState("");
  const ledger = useLedgerHedera();

  // Cancel only applies to a live switch (the page also gates on status === "ACTIVE").
  if (view.status !== "ACTIVE") return null;

  const memo = cancelMemo(view.topicId);
  const deviceBusy = ledger.phase === "connecting" || ledger.phase === "signing";

  async function honorCancel(account: string, tx: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
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
      if (onRefresh) onRefresh();
      else if (typeof window !== "undefined") window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // One-click: sign the 1-tinybar cancel transfer on the device, then honor it.
  async function deviceCancel() {
    const tx = await ledger.signTransfer({ memo, amountTinybar: 1 });
    if (tx && ledger.account) await honorCancel(ledger.account, tx);
  }

  // Manual fallback: honor a cancel transfer signed out-of-band.
  async function manualCancel() {
    const account = manualAccount.trim();
    const tx = manualTx.trim();
    if (!/^\d+\.\d+\.\d+$/.test(account)) {
      setError("Enter the Ledger account id that signed the cancel transfer (0.0.x).");
      return;
    }
    if (!tx) {
      setError("Paste the cancel transaction id, or just wait — the watcher backstop will honor the signed transfer.");
      return;
    }
    await honorCancel(account, tx);
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
            The cancel transfer carries this exact memo:
          </p>
          <p className="break-all rounded-md bg-neutral-900 p-2 font-mono text-xs text-neutral-300">
            {memo}
          </p>

          {/* One-click device path. */}
          {ledger.supported ? (
            <div className="space-y-2 rounded-md border border-neutral-800 bg-neutral-900/50 p-3">
              {ledger.account ? (
                <p className="text-[11px] text-neutral-500">
                  Ledger account <span className="font-mono text-emerald-300">{ledger.account}</span>
                </p>
              ) : null}
              {ledger.prompt ? (
                <p className="flex items-center gap-2 text-xs text-neutral-300">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                  {ledger.prompt}
                </p>
              ) : null}
              {ledger.error ? (
                <p
                  className={`text-xs ${ledger.error.rejected ? "text-amber-300" : "text-red-400"}`}
                >
                  {ledger.error.message}
                </p>
              ) : null}

              {ledger.phase === "idle" || ledger.phase === "connecting" ? (
                <button
                  disabled={deviceBusy}
                  onClick={() => void ledger.connect()}
                  className="w-full rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {ledger.phase === "connecting" ? "Connecting…" : "Connect Ledger & find account"}
                </button>
              ) : (
                <button
                  disabled={deviceBusy || busy}
                  onClick={() => void deviceCancel()}
                  className="w-full rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {ledger.phase === "signing" ? "Signing on device…" : "Sign cancel on Ledger"}
                </button>
              )}
            </div>
          ) : null}

          {/* Manual fallback: a transfer signed elsewhere. */}
          <details className="rounded-md border border-neutral-800 bg-neutral-900/50 p-3">
            <summary className="cursor-pointer text-xs text-neutral-400">
              Or paste a cancel transaction id signed elsewhere
            </summary>
            <div className="mt-3 space-y-2">
              <input
                value={manualAccount}
                onChange={(e) => setManualAccount(e.target.value)}
                placeholder="Ledger account id (0.0.x)"
                className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
              />
              <input
                value={manualTx}
                onChange={(e) => setManualTx(e.target.value)}
                placeholder="Cancel tx id (0.0.x-secs-nanos)"
                className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
              />
              <button
                disabled={busy}
                onClick={() => void manualCancel()}
                className="w-full rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy ? "Cancelling…" : "Honor cancel now"}
              </button>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
