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
    <div className="compose">
      <p className="compose__tag">🔏 Signed on-device · the key never leaves your Ledger</p>

      <details className="peek">
        <summary>Memo to confirm on the Trusted Display</summary>
        <p className="peek__body mt-2">DMTT:ARM:{policyHash}</p>
      </details>

      <button type="button" disabled={busy} onClick={sign} className="btn btn--gold w-full">
        {busy ? "Waitin' on yer device…" : `Sign the ${fundingHbar} ℏ arm transfer`}
      </button>

      <p className="compose__note">
        Stub — real WebHID device signing arrives in Phase 5; this emits a mock arm
        artifact so the flow is walkable end-to-end.
      </p>
    </div>
  );
}
