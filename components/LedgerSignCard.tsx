"use client";

// LedgerSignCard — STUB for the device-signed ARM CryptoTransfer (C1).
//
// In production (Phase 5 / M2, human-owned) this is a WebHID flow: @ledgerhq/hw-app-
// hedera + @ledgerhq/hw-transport-webhid sign a CryptoTransfer(Ledger → agent, FUNDING,
// memo="DMTT:ARM:"+policyHash) on-device, with the memo shown on the Trusted Display.
// The device key NEVER leaves the device. @ledgerhq/hw-app-hedera is NOT installed in
// wave 1, so this card emits a clearly-labeled MOCK { armTxId, ledgerAccountId } so the
// wizard flows; nothing here authorizes a real transfer.

import { useState } from "react";
import type { AccountId, TxId } from "@/lib/types.ts";

export interface LedgerSigned {
  armTxId: TxId;
  ledgerAccountId: AccountId;
}

/** A plausible-shaped mock tx id "{payer}-{validStartSecs}-{nanos}" + a mock account. */
function mockArtifacts(): LedgerSigned {
  const ledgerAccountId = "0.0.1234567";
  const secs = Math.floor(Date.now() / 1000);
  return {
    ledgerAccountId,
    armTxId: `${ledgerAccountId}-${secs}-000000000`,
  };
}

export function LedgerSignCard({
  policyHash,
  fundingHbar,
  onSigned,
}: {
  policyHash: string;
  fundingHbar: number;
  onSigned: (signed: LedgerSigned) => void;
}) {
  const [busy, setBusy] = useState(false);

  function sign() {
    setBusy(true);
    // Simulate the on-device confirmation latency, then emit the mock artifact.
    setTimeout(() => {
      onSigned(mockArtifacts());
      setBusy(false);
    }, 400);
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
      <h2 className="text-lg font-semibold">Arm with your Ledger</h2>
      <p className="mt-1 text-xs text-neutral-400">
        Your device signs a {fundingHbar} ℏ funding transfer to the agent. The memo shown
        on the Trusted Display will read:
      </p>
      <p className="mt-2 break-all rounded-md bg-neutral-900 p-2 font-mono text-xs text-neutral-300">
        DMTT:ARM:{policyHash}
      </p>

      <button
        type="button"
        disabled={busy}
        onClick={sign}
        className="mt-4 w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Waiting for device…" : "Sign on device (stub)"}
      </button>

      <p className="mt-3 text-[11px] text-amber-400">
        Stub — real WebHID device signing arrives in Phase 5. This emits a mock arm
        artifact so the flow is walkable end-to-end.
      </p>
    </div>
  );
}
