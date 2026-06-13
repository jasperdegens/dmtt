// watcher/cancel-backstop.ts — Phase 5 device-signed cancel backstop (WS-D).
//
// The cancel ceremony's ROOT authority is the device-signed CryptoTransfer
// (Ledger → agent, 1 tinybar, memo "DMTT:CANCEL:<topicId>" — CLAUDE.md C1). The web
// client normally posts that txId to POST /api/cancel, but the DEVICE SIGNATURE is the
// authority, not the HTTP call. This backstop makes cancel robust to a missing/failed
// client call: the watcher polls the AGENT account's inbound transactions via the
// mirror, and for any SUCCESS tx whose memo decodes to DMTT:CANCEL:<topicId> of a known
// ACTIVE switch, it honors the cancel through the SAME executor — which re-runs the
// mirror-verify recipe (SUCCESS + memo + Ledger debit) before tearing down. Defense in
// depth: the backstop only DISCOVERS the cancel; the executor still authorizes it.
//
// PURE + dependency-injected (like release.ts): no SDK/fs/network here. Idempotent —
// an already-CANCELLED/RELEASED switch is skipped (the executor's NOT_ACTIVE guard is
// the second line), so a cancel already handled by the UI never double-fires.

import { parseCancelMemo } from "../lib/types.ts";
import type {
  AccountId,
  MirrorTransaction,
  SwitchStore,
  TopicId,
  TxId,
} from "../lib/types.ts";

/** The injected world the cancel backstop runs against (tests pass mocks; the runnable
 *  watcher in index.ts wires the real store / mirror / cancel executor). */
export interface CancelBackstopDeps {
  /** Only `load` is needed — the cancel executor does its own withLock teardown. */
  store: Pick<SwitchStore, "load">;
  /** Page the agent account's transactions with consensus_timestamp > afterTimestamp (asc). */
  listAccountTransactions: (afterTimestamp?: string) => Promise<MirrorTransaction[]>;
  /** Honor a detected device-signed cancel via the cancel executor. Returns true ONLY
   *  when the switch actually transitioned to CANCELLED (verify rejected / already
   *  inactive ⇒ false, never throws for those — only infra errors propagate). */
  honorCancel: (topicId: TopicId, cancelTxId: TxId, ledgerAccountId: AccountId) => Promise<boolean>;
}

/** Mutable consensus-timestamp cursor ("secs.nanos"); advanced past every scanned tx so
 *  a tx is never re-scanned. Seeded to the watcher's start time (catch cancels forward). */
export interface CancelCursor {
  ts: string | null;
}

/** Decode a base64 tx memo to utf8, or null (no memo / undecodable — never throws). */
export function decodeMemo(memoBase64: string | null): string | null {
  if (memoBase64 == null) return null;
  try {
    return Buffer.from(memoBase64, "base64").toString("utf8");
  } catch {
    return null;
  }
}

/**
 * One backstop pass: scan the agent account's inbound txs after the cursor and honor any
 * cancel memo for a known ACTIVE switch. Returns the count of switches actually CANCELLED.
 *
 * The cursor advances past each scanned tx AFTER it is fully handled. An infra error from
 * honorCancel propagates (the watcher's tick catches + logs), leaving the cursor BEFORE
 * the failed tx so the next pass retries it (errs toward honoring the user's cancel).
 */
export async function scanCancels(deps: CancelBackstopDeps, cursor: CancelCursor): Promise<number> {
  const txs = await deps.listAccountTransactions(cursor.ts ?? undefined);
  let cancelled = 0;

  for (const tx of txs) {
    const topicId = parseCancelMemo(decodeMemo(tx.memoBase64));
    if (tx.result === "SUCCESS" && topicId) {
      const sw = await deps.store.load(topicId);
      // Idempotent: only a known ACTIVE switch can be cancelled here. An already
      // CANCELLED/RELEASED switch (e.g. the UI got there first) is silently skipped.
      if (sw && sw.status === "ACTIVE") {
        if (await deps.honorCancel(topicId, tx.transactionId, sw.ledgerAccountId)) {
          cancelled += 1;
        }
      }
    }
    // Advance only after the tx is fully handled — asc order means the last tx is the
    // high-water mark for the next pass's `timestamp=gt:` filter.
    if (tx.consensusTimestamp) cursor.ts = tx.consensusTimestamp;
  }

  return cancelled;
}
