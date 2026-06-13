"use client";

// app/page.tsx — the single-page DMTT wizard (WS-F).
//
// A FIXED stepper (CLAUDE.md: the flow is a state machine, not free-form): MEMO →
// TERMS → WORLD → SIGN → ARM. Each card captures one artifact; the page never
// advances without it. PLAINTEXT and K never leave the browser — MemoCard encrypts
// locally and hands back only the ciphertext + its hash; the page never posts
// plaintext anywhere. ?t= phase routing (history.replaceState) lets a refresh /
// deep-link land on the right step.
//
// Arm itself (upload ciphertext, mint the ladder from K, POST /api/arm) is owned by
// the arm route + executor; this page assembles the captured artifacts and submits
// them, then links to the per-switch status/reveal view at /s/[topicId].

import { useCallback, useEffect, useState } from "react";

import { MemoCard, type MemoCaptured } from "@/components/MemoCard.tsx";
import { TermsChips } from "@/components/TermsChips.tsx";
import { WorldVerifyCard, type WorldVerified } from "@/components/WorldVerifyCard.tsx";
import { LedgerSignCard, type LedgerSigned } from "@/components/LedgerSignCard.tsx";
import {
  policyHash as computePolicyHash,
  mintLadder,
  randomNonceHex,
} from "@/lib/crypto.ts";
import type {
  Policy,
  Terms,
  StorageRef,
  ArmInput,
  ArmArtifacts,
} from "@/lib/types.ts";

// The fixed phases (mirrors chat-machine's ChatState, lowercase for the URL).
const PHASES = ["memo", "terms", "world", "sign", "armed"] as const;
type Phase = (typeof PHASES)[number];

function isPhase(v: string | null): v is Phase {
  return v !== null && (PHASES as readonly string[]).includes(v);
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("memo");
  const [memo, setMemo] = useState<MemoCaptured | null>(null);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [world, setWorld] = useState<WorldVerified | null>(null);
  const [signed, setSigned] = useState<LedgerSigned | null>(null);

  const [arming, setArming] = useState(false);
  const [armError, setArmError] = useState<string | null>(null);
  const [topicId, setTopicId] = useState<string | null>(null);

  // The commitment salt — fixed once so the policyHash the device signs at the SIGN
  // step is exactly the one the arm executor recomputes (policyHash omits armTime).
  const [nonce] = useState<string>(() => randomNonceHex());

  // ?t= phase routing — read on mount, then keep the URL in sync (replaceState, no
  // history spam). Guarded so a hand-edited ?t= can't skip past missing artifacts.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t");
    if (isPhase(t)) setPhase(t);
  }, []);

  const goto = useCallback((next: Phase) => {
    setPhase(next);
    const url = new URL(window.location.href);
    url.searchParams.set("t", next);
    window.history.replaceState(null, "", url.toString());
  }, []);

  // The policyHash the Ledger memo commits to (over the assembled Policy). Computed
  // once we have a memo, terms, and a verified nullifier.
  const policy: Policy | null =
    memo && terms && world
      ? {
          terms,
          nullifier: world.nullifier,
          ciphertextHash: memo.ciphertextHash,
          nonce,
        }
      : null;
  const policyHashHex = policy ? computePolicyHash(policy) : "";

  // The full arm assembly happens HERE, client-side: upload the ciphertext, mint the
  // tlock ladder from K (then drop K), and POST a complete ArmInput + ArmArtifacts.
  // K and the plaintext never leave the browser.
  async function arm() {
    if (!memo || !terms || !world || !signed || !policy) return;
    setArming(true);
    setArmError(null);
    try {
      // 1. Upload ciphertext to the agent's storage → StorageRef (HFS/HCS by size).
      const up = await fetch("/api/storage", {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: memo.ciphertext as BodyInit,
      });
      if (!up.ok) throw new Error(`storage failed (${up.status})`);
      const storage = (await up.json()) as StorageRef;

      // 2. Mint the ladder from K (N capsules sealed to the rung grid), then drop K.
      const armTime = Date.now();
      const ladder = await mintLadder(memo.key, armTime, terms);

      // 3. Submit the assembled arm. The agent receives the sealed (private) rungs.
      const input: ArmInput = {
        policy,
        policyHash: policyHashHex,
        storage,
        ladder,
        armTime,
      };
      const artifacts: ArmArtifacts = {
        armTxId: signed.armTxId,
        ledgerAccountId: signed.ledgerAccountId,
        fundingHbar: terms.fundingHbar,
      };
      const res = await fetch("/api/arm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input, artifacts }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(`arm failed (${res.status})${err ? `: ${JSON.stringify(err.error)}` : ""}`);
      }
      const body = (await res.json()) as { topicId: string };
      setTopicId(body.topicId);
      goto("armed");
    } catch (e) {
      setArmError(e instanceof Error ? e.message : String(e));
    } finally {
      setArming(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Dead Men Tell Tales</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Encrypt a memo, arm it with your Ledger and World ID, check in to stay quiet.
          Go silent and the network releases it.
        </p>
      </header>

      <Stepper phase={phase} />

      <div className="mt-6 space-y-4">
        {phase === "memo" ? (
          <MemoCard
            onCaptured={(m) => {
              setMemo(m);
              goto("terms");
            }}
          />
        ) : null}

        {phase === "terms" ? (
          <TermsChips
            onTerms={(t) => {
              setTerms(t);
              goto("world");
            }}
          />
        ) : null}

        {phase === "world" ? (
          <WorldVerifyCard
            signal={memo?.ciphertextHash ?? ""}
            onVerified={(v) => {
              setWorld(v);
              goto("sign");
            }}
          />
        ) : null}

        {phase === "sign" ? (
          <>
            <LedgerSignCard
              policyHash={policyHashHex}
              fundingHbar={terms?.fundingHbar ?? 0}
              onSigned={setSigned}
            />
            {signed ? (
              <button
                type="button"
                disabled={arming}
                onClick={arm}
                className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {arming ? "Arming…" : "Arm the switch"}
              </button>
            ) : null}
            {armError ? <p className="text-xs text-red-400">{armError}</p> : null}
          </>
        ) : null}

        {phase === "armed" ? (
          <div className="rounded-xl border border-emerald-900 bg-neutral-950 p-5">
            <h2 className="text-lg font-semibold text-emerald-300">Armed.</h2>
            <p className="mt-2 text-sm text-neutral-400">
              Your switch is live. Check in each interval to postpone release.
            </p>
            {topicId ? (
              <a
                href={`/s/${topicId}`}
                className="mt-4 inline-block rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white"
              >
                Open switch status →
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}

function Stepper({ phase }: { phase: Phase }) {
  const labels: Record<Phase, string> = {
    memo: "Memo",
    terms: "Terms",
    world: "World ID",
    sign: "Sign",
    armed: "Armed",
  };
  const current = PHASES.indexOf(phase);
  return (
    <ol className="flex items-center gap-2 text-xs">
      {PHASES.map((p, i) => (
        <li
          key={p}
          className={`flex items-center gap-2 ${i <= current ? "text-emerald-400" : "text-neutral-600"}`}
        >
          <span
            className={`grid h-5 w-5 place-items-center rounded-full border text-[10px] ${
              i <= current ? "border-emerald-600 bg-emerald-950" : "border-neutral-700"
            }`}
          >
            {i + 1}
          </span>
          {labels[p]}
          {i < PHASES.length - 1 ? <span className="text-neutral-700">·</span> : null}
        </li>
      ))}
    </ol>
  );
}
