"use client";

// LedgerSignCard — the device-signed ARM CryptoTransfer (C1), over the Device Management Kit.
//
// Connect → identify (derive m/44'/3030'/0'/0'/0' and resolve its Hedera account on the
// mirror) → sign a CryptoTransfer(Ledger → agent, FUNDING, memo="DMTT:ARM:"+policyHash) on
// device → relay it. The emitted { armTxId, ledgerAccountId } is exactly what the arm
// executor mirror-verifies. The shared ceremony lives in useLedgerHedera; this card just
// wires it to the arm memo/amount. A clearly-labelled, env-gated dev mock keeps the chat
// flow walkable on machines without a device.

import { hederaDerivationPath } from "./ledgerDmkHedera.ts";
import { useLedgerHedera } from "./useLedgerHedera.ts";
import type { AccountId, TxId } from "@/lib/types.ts";
import { armMemo } from "@/lib/types.ts";

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
    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
      <h2 className="text-lg font-semibold">Arm with your Ledger</h2>
      <p className="mt-1 text-xs text-neutral-400">
        Your device signs a {fundingHbar} ℏ funding transfer to the agent. The Trusted
        Display will show the recipient, the amount, and this memo:
      </p>
      <p className="mt-2 break-all rounded-md bg-neutral-900 p-2 font-mono text-xs text-neutral-300">
        {memo}
      </p>

      {!ledger.supported ? (
        <p className="mt-4 rounded-md border border-amber-900 bg-amber-950/40 p-2 text-xs text-amber-300">
          This browser can’t reach a Ledger over USB. Use desktop Chrome, Edge or Brave over
          HTTPS (or localhost).
        </p>
      ) : null}

      {ledger.account ? (
        <div className="mt-4 rounded-md border border-neutral-800 bg-neutral-900 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-neutral-400">Ledger account</span>
            <span className="font-mono text-emerald-300">{ledger.account}</span>
          </div>
          <div className="mt-1 truncate text-[11px] text-neutral-500">
            {hederaDerivationPath()} · key {ledger.pubKey?.slice(0, 16)}…
          </div>
        </div>
      ) : null}

      {ledger.prompt ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-neutral-300">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          {ledger.prompt}
        </p>
      ) : null}

      {ledger.error ? (
        <p
          className={`mt-3 rounded-md border p-2 text-xs ${
            ledger.error.rejected
              ? "border-amber-900 bg-amber-950/40 text-amber-300"
              : "border-red-900 bg-red-950/40 text-red-300"
          }`}
        >
          {ledger.error.message}
        </p>
      ) : null}

      {ledger.phase === "idle" || ledger.phase === "connecting" ? (
        <button
          type="button"
          disabled={!ledger.supported || busy}
          onClick={() => void ledger.connect()}
          className="mt-4 w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {ledger.phase === "connecting" ? "Connecting…" : "Connect Ledger & find account"}
        </button>
      ) : null}

      {ledger.phase === "identified" || ledger.phase === "signing" ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void sign()}
          className="mt-4 w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {ledger.phase === "signing" ? "Signing on device…" : `Sign ${fundingHbar} ℏ transfer on Ledger`}
        </button>
      ) : null}

      {ledger.phase === "done" ? (
        <p className="mt-4 rounded-md border border-emerald-900 bg-emerald-950/40 p-2 text-xs text-emerald-300">
          Signed and submitted on-chain. Arm the switch below.
        </p>
      ) : null}

      {/* Dev-only escape hatch so the flow is walkable without a device. */}
      {DEV_MOCK_ENABLED && ledger.phase !== "done" ? (
        <button
          type="button"
          onClick={() => onSigned(mockArtifacts())}
          className="mt-2 w-full rounded-md border border-neutral-700 px-4 py-2 text-xs text-neutral-400"
        >
          Use mock artifact (dev, no device)
        </button>
      ) : null}
    </div>
  );
}
