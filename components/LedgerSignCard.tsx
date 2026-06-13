"use client";

// LedgerSignCard — the device-signed ARM CryptoTransfer (C1), over the Device Management Kit.
//
// Connect → identify (derive m/44'/3030'/0'/0'/0' and resolve its Hedera account on the
// mirror) → sign a CryptoTransfer(Ledger → agent, FUNDING, memo="DMTT:ARM:"+policyHash) on
// device → relay it. The emitted { armTxId, ledgerAccountId } is exactly what the arm
// executor mirror-verifies. The shared ceremony lives in useLedgerHedera; this card just
// wires it to the arm memo/amount. A clearly-labelled, env-gated dev mock keeps the chat
// flow walkable on machines without a device.

import { useLedgerHedera } from "./useLedgerHedera.ts";
import type { AccountId, TxId } from "@/lib/types.ts";
import { armMemo } from "@/lib/types.ts";
import { BusyLabel } from "./BusyLabel.tsx";

export interface LedgerSigned {
  armTxId: TxId;
  ledgerAccountId: AccountId;
}

const DEV_MOCK_ENABLED = process.env.NEXT_PUBLIC_DMTT_LEDGER_MOCK === "true";

/** A plausible-shaped mock tx id "{payer}-{validStartSecs}-{nanos}" + a mock account. */
function mockArtifacts(): LedgerSigned {
  const ledgerAccountId = "0.0.1234567";
  const secs = Math.floor(Date.now() / 1000);
  return { ledgerAccountId, armTxId: `${ledgerAccountId}-${secs}-000000000` };
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
  const ledger = useLedgerHedera();
  const memo = armMemo(policyHash);
  const busy = ledger.phase === "connecting" || ledger.phase === "signing";

  async function sign() {
    const armTxId = await ledger.signTransfer({ memo, amountHbar: fundingHbar });
    if (armTxId && ledger.account) onSigned({ armTxId, ledgerAccountId: ledger.account });
  }

  return (
    <div className="compose">
      <p className="compose__tag">🔏 Signed on-device · the key never leaves your Ledger</p>

      <p className="compose__lead">
        Yer device signs a {fundingHbar} ℏ funding transfer to the agent. The Trusted
        Display shows the recipient, the amount, and this memo:
      </p>

      <details className="peek" open>
        <summary>Memo to confirm on the Trusted Display</summary>
        <p className="peek__body mt-2">{memo}</p>
      </details>

      {!ledger.supported ? (
        <p className="compose__err">
          This browser can’t reach a Ledger over USB. Use desktop Chrome, Edge or Brave over
          HTTPS (or localhost).
        </p>
      ) : null}

      {ledger.account ? (
        <div className="ledger-account" aria-label="Connected Ledger account">
          <span className="ledger-account__label">Ledger account</span>
          <code className="ledger-account__value">{ledger.account}</code>
        </div>
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
          type="button"
          disabled={!ledger.supported || busy}
          aria-busy={ledger.phase === "connecting"}
          onClick={() => void ledger.connect()}
          className="btn btn--gold w-full"
        >
          {ledger.phase === "connecting" ? (
            <BusyLabel>Connectin’</BusyLabel>
          ) : (
            "Connect yer Ledger & find account"
          )}
        </button>
      ) : null}

      {ledger.phase === "identified" || ledger.phase === "signing" ? (
        <button
          type="button"
          disabled={busy}
          aria-busy={ledger.phase === "signing"}
          onClick={() => void sign()}
          className="btn btn--gold w-full"
        >
          {ledger.phase === "signing" ? (
            <BusyLabel>Waitin’ on yer device</BusyLabel>
          ) : (
            `Sign the ${fundingHbar} ℏ arm transfer`
          )}
        </button>
      ) : null}

      {ledger.phase === "done" ? (
        <p className="compose__ok">Signed and submitted on-chain. Arm the switch below.</p>
      ) : null}

      {/* Dev-only escape hatch so the flow is walkable without a device. */}
      {DEV_MOCK_ENABLED && ledger.phase !== "done" ? (
        <button
          type="button"
          onClick={() => onSigned(mockArtifacts())}
          className="btn btn--ghost w-full"
        >
          Use mock artifact (dev, no device)
        </button>
      ) : null}
    </div>
  );
}
