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
import { BusyLabel } from "./BusyLabel.tsx";
import { DisclosureToggle } from "./DisclosureToggle.tsx";
import { LedgerAccountField } from "./LedgerAccountField.tsx";
import { useLedgerHedera } from "./useLedgerHedera.ts";
import { usePirate } from "./scene/PirateContext.tsx";

export function SwitchActions({ view, onRefresh }: { view: SwitchView; onRefresh?: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualAccount, setManualAccount] = useState("");
  const [manualTx, setManualTx] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const ledger = useLedgerHedera();
  const { runWhile } = usePirate();

  // Cancel only applies to a live switch (the page also gates on status === "ACTIVE").
  if (view.status !== "ACTIVE") return null;

  const memo = cancelMemo(view.topicId);
  const deviceBusy = ledger.phase === "connecting" || ledger.phase === "signing";

  async function honorCancel(account: string, tx: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await runWhile("waiting", async () => {
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
      });
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
      setError(
        "Paste the cancel transaction id, or just wait — the watcher backstop will honor the signed transfer.",
      );
      return;
    }
    await honorCancel(account, tx);
  }

  return (
    <div className="compose compose--danger">
      <p className="compose__tag">☠ Stand down · authorized by a Ledger transfer, not this page</p>

      {message ? <p className="compose__ok">{message}</p> : null}
      {error ? <p className="compose__err break-words">{error}</p> : null}

      {!open ? (
        <button disabled={busy} onClick={() => setOpen(true)} className="btn btn--danger">
          Stand the pact down…
        </button>
      ) : (
        <div className="space-y-2.5">
          <p className="compose__lead">
            On yer Ledger, sign a 1 tinybar transfer to the agent with this exact memo:
          </p>
          <p className="peek__body">{memo}</p>

          {/* One-click device path. */}
          {ledger.supported ? (
            <div className="space-y-2.5">
              {ledger.account ? (
                <LedgerAccountField account={ledger.account} />
              ) : null}
              {ledger.prompt ? (
                <p className="compose__lead flex items-center gap-2">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                  {ledger.prompt}
                </p>
              ) : null}
              {ledger.error ? (
                <p className={ledger.error.rejected ? "compose__note" : "compose__err"}>
                  {ledger.error.message}
                </p>
              ) : null}

              {ledger.phase === "idle" || ledger.phase === "connecting" ? (
                <button
                  disabled={deviceBusy}
                  aria-busy={ledger.phase === "connecting"}
                  onClick={() => void ledger.connect()}
                  className="btn btn--danger w-full"
                >
                  {ledger.phase === "connecting" ? (
                    <BusyLabel>Connectin’</BusyLabel>
                  ) : (
                    "Connect yer Ledger & find account"
                  )}
                </button>
              ) : (
                <button
                  disabled={deviceBusy || busy}
                  aria-busy={ledger.phase === "signing" || busy}
                  onClick={() => void deviceCancel()}
                  className="btn btn--danger w-full"
                >
                  {ledger.phase === "signing" ? (
                    <BusyLabel>Signin’ on device</BusyLabel>
                  ) : busy ? (
                    <BusyLabel>Standin’ down</BusyLabel>
                  ) : (
                    "Sign cancel on Ledger"
                  )}
                </button>
              )}
            </div>
          ) : null}

          {/* Manual fallback: a transfer signed elsewhere. */}
          <div className="space-y-2">
            <DisclosureToggle
              open={manualOpen}
              closedLabel="Paste a cancel transaction id signed elsewhere"
              openLabel="Hide pasted cancel transaction id"
              onToggle={() => setManualOpen((v) => !v)}
            />
            {manualOpen ? (
              <div className="mt-3 space-y-2">
                <input
                  value={manualAccount}
                  onChange={(e) => setManualAccount(e.target.value)}
                  placeholder="Ledger account id (0.0.x)"
                  className="field"
                />
                <input
                  value={manualTx}
                  onChange={(e) => setManualTx(e.target.value)}
                  placeholder="Cancel tx id (0.0.x-secs-nanos)"
                  className="field"
                />
                <button
                  disabled={busy}
                  aria-busy={busy}
                  onClick={() => void manualCancel()}
                  className="btn btn--danger w-full"
                >
                  {busy ? <BusyLabel>Standin’ down</BusyLabel> : "Honor cancel now"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
