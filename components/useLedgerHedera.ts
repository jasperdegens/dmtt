"use client";

// useLedgerHedera — the shared Ledger ⇄ Hedera ceremony for the two device-signed C1
// operations (ARM funding transfer, CANCEL transfer). Both run the same steps —
// connect → open the Hedera app → identify the account → build/sign/submit a memo'd
// CryptoTransfer — so the orchestration lives here once and LedgerSignCard / SwitchActions
// just supply the memo and amount. Device logic is in ./ledgerDmkHedera.ts; the two
// backend round-trips (build, submit) are the app glue.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DeviceManagementKit } from "@ledgerhq/device-management-kit";

import {
  buildHederaDmk,
  bytesToHex,
  connectLedger,
  disconnectLedger,
  getHederaPublicKey,
  hexToBytes,
  isWebHidSupported,
  type LedgerPrompt,
  LedgerError,
  openHederaApp,
  signHederaTransactionBody,
  toLedgerError,
} from "./ledgerDmkHedera.ts";

export type LedgerPhase = "idle" | "connecting" | "identified" | "signing" | "done";

const PROMPT_TEXT: Record<LedgerPrompt, string> = {
  unlock: "Unlock your Ledger — enter your PIN on the device.",
  "confirm-open-app": "Confirm opening the Hedera app on your Ledger.",
  review: "Review the transfer on your Ledger and approve it.",
  working: "Working on the device…",
};

export interface LedgerHedera {
  supported: boolean;
  phase: LedgerPhase;
  prompt: string | null;
  error: { message: string; rejected: boolean } | null;
  account: string | null;
  pubKey: string | null;
  /** Connect over WebHID, open the Hedera app, and resolve the account id (→ "identified"). */
  connect: () => Promise<void>;
  /** Build → sign on device → submit a memo'd transfer. Returns the on-chain tx id, or null on error.
   *  Clears any prior error on entry, so calling it again is the retry path. */
  signTransfer: (args: {
    memo: string;
    amountHbar?: number;
    amountTinybar?: number;
  }) => Promise<string | null>;
}

export function useLedgerHedera(): LedgerHedera {
  const supported = useMemo(() => isWebHidSupported(), []);
  const dmk = useMemo<DeviceManagementKit | null>(
    () => (supported ? buildHederaDmk() : null),
    [supported],
  );
  const sessionRef = useRef<string | null>(null);
  const pubKeyRef = useRef<string | null>(null);

  const [phase, setPhase] = useState<LedgerPhase>("idle");
  const [prompt, setPrompt] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; rejected: boolean } | null>(null);
  const [account, setAccount] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      const sid = sessionRef.current;
      if (dmk && sid) void disconnectLedger(dmk, sid);
      if (dmk) void dmk.close();
    };
  }, [dmk]);

  const fail = useCallback((e: unknown) => {
    const le = toLedgerError(e);
    setError({ message: le.message, rejected: le.kind === "rejected" });
    setPrompt(null);
  }, []);

  const connect = useCallback(async () => {
    if (!dmk) return;
    setError(null);
    setPhase("connecting");
    setPrompt("Select your Ledger in the browser dialog…");
    try {
      const sessionId = await connectLedger(dmk);
      sessionRef.current = sessionId;

      setPrompt("Open the Hedera app…");
      await openHederaApp(dmk, sessionId, (p) => setPrompt(PROMPT_TEXT[p]));

      setPrompt("Reading your account key…");
      const key = await getHederaPublicKey(dmk, sessionId, { display: false });
      pubKeyRef.current = key;

      const res = await fetch("/api/ledger/account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicKey: key }),
      });
      const data = (await res.json().catch(() => null)) as
        | { accountId: string | null; accounts: string[]; error?: string }
        | null;
      if (!res.ok || !data) {
        throw new LedgerError("unknown", data?.error ?? `account lookup failed (${res.status})`);
      }
      if (!data.accountId) {
        throw new LedgerError(
          "unknown",
          "No Hedera account is linked to this Ledger key yet. Create and fund one for this key, then try again.",
        );
      }
      setAccount(data.accountId);
      setPrompt(null);
      setPhase("identified");
    } catch (e) {
      if (dmk && sessionRef.current) await disconnectLedger(dmk, sessionRef.current);
      sessionRef.current = null;
      setPhase("idle");
      fail(e);
    }
  }, [dmk, fail]);

  const signTransfer = useCallback(
    async (args: { memo: string; amountHbar?: number; amountTinybar?: number }): Promise<string | null> => {
      const sessionId = sessionRef.current;
      const pubKey = pubKeyRef.current;
      if (!dmk || !sessionId || !account || !pubKey) return null;
      setError(null);
      setPhase("signing");
      try {
        setPrompt("Preparing the transfer…");
        const buildRes = await fetch("/api/ledger/build-transfer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ledgerAccountId: account,
            amountHbar: args.amountHbar,
            amountTinybar: args.amountTinybar,
            memo: args.memo,
          }),
        });
        const built = (await buildRes.json().catch(() => null)) as
          | { frozenTxBase64: string; bodyHex: string; transactionId: string; error?: string }
          | null;
        if (!buildRes.ok || !built) {
          throw new LedgerError("unknown", built?.error ?? `build failed (${buildRes.status})`);
        }

        setPrompt(PROMPT_TEXT.review);
        const signature = await signHederaTransactionBody(dmk, sessionId, hexToBytes(built.bodyHex));

        setPrompt("Submitting to Hedera…");
        const submitRes = await fetch("/api/ledger/submit-transfer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            frozenTxBase64: built.frozenTxBase64,
            publicKey: pubKey,
            signature: bytesToHex(signature),
          }),
        });
        const submitted = (await submitRes.json().catch(() => null)) as
          | { transactionId: string; status: string; error?: string }
          | null;
        if (!submitRes.ok || !submitted) {
          throw new LedgerError("unknown", submitted?.error ?? `submit failed (${submitRes.status})`);
        }

        setPrompt(null);
        setPhase("done");
        return submitted.transactionId;
      } catch (e) {
        setPhase("identified");
        fail(e);
        return null;
      }
    },
    [dmk, account, fail],
  );

  return {
    supported,
    phase,
    prompt,
    error,
    account,
    pubKey: pubKeyRef.current,
    connect,
    signTransfer,
  };
}
