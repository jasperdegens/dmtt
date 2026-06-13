"use client";

// components/Chat.tsx — the chat-flow shell (WS-E, Phase 7) reframed as the captain's
// speech bubble (Phase 8).
//
// The whole DMTT lifecycle lives in ONE chat interface: it asks one thing at a time in
// bubbles and accepts either the structured step card OR free text (deterministic — no
// LLM required). The flow is a FIXED state machine (CLAUDE.md): MEMO → TERMS → WORLD →
// SIGN → ARM, then the live switch (check-in / cancel / reveal). The cards render INLINE
// as chat answers; nothing here is a modal wizard.
//
// Three hard invariants are enforced here (UNCHANGED by the visual overhaul):
//   1. PLAINTEXT and the key K NEVER leave the browser. The MemoCard encrypts locally;
//      this component holds the captured { ciphertext, key } in React memory and posts
//      ONLY the ciphertext bytes (to /api/storage) and metadata (ciphertextHash) — never
//      the plaintext, never to /api/chat.
//   2. Steps advance SOLELY on captured artifacts via reduce() (the security gate). The
//      free-text bar was removed (it had no purpose in the fixed flow), so nothing typed
//      can move a step or arm — the structured step cards are the only inputs.
//   3. The machine advances client-side via reduce() and stays correct with the LLM (or
//      the whole /api/chat route) offline; /api/chat only supplies optional narration.
//
// Phase 8 additions: the captain (PirateContext) reacts to the flow — thinking while a
// step advances, encrypting while the arm payload is built, talking as a line lands,
// waiting between steps — and every scripted step shows for at least MIN_ACTION_MS so
// the animation reads. None of this gates the machine; it's pure presentation.

import { useCallback, useEffect, useRef, useState } from "react";

import { MemoCard, type MemoCaptured } from "./MemoCard.tsx";
import { TermsChips } from "./TermsChips.tsx";
import { WorldVerifyCard, type WorldVerified } from "./WorldVerifyCard.tsx";
import { LedgerSignCard, type LedgerSigned } from "./LedgerSignCard.tsx";
import { StatusCard } from "./StatusCard.tsx";
import { CheckinCard } from "./CheckinCard.tsx";
import { SwitchActions } from "./SwitchActions.tsx";
import { RevealCard } from "./RevealCard.tsx";
import { MessageList } from "./chat/MessageList.tsx";
import { StepIndicator } from "./chat/StepIndicator.tsx";
import type { ChatLink, ChatMessage } from "./chat/types.ts";
import { usePirate } from "./scene/PirateContext.tsx";

import {
  narrate,
  reduce,
  type ChatContext,
  type ChatEvent,
  type ChatState,
} from "@/lib/chat-machine.ts";
import {
  policyHash as computePolicyHash,
  mintLadder,
  randomNonceHex,
} from "@/lib/crypto.ts";
import { MIN_ACTION_MS } from "@/lib/pirate.ts";
import type {
  ArmArtifacts,
  ArmInput,
  CheckinResult,
  Policy,
  StorageRef,
  SwitchView,
  Terms,
  WorldEnvironment,
} from "@/lib/types.ts";

const PUBLIC_WORLD_ENV =
  process.env.NEXT_PUBLIC_WORLD_ENV ?? process.env.NEXT_PUBLIC_WLD_ENVIRONMENT;
const WORLD_ENV: WorldEnvironment =
  PUBLIC_WORLD_ENV === "staging" ? "staging" : "production";

const POLL_MS = 10_000;

const INTRO =
  "Arrr, welcome aboard, ye magnificent doomed soul. I'm Cap'n Mordecai Graves — keeper o' the Deadman's Pact. The bargain's simple: ye trust me with yer last words, an' I loose 'em upon the world ONLY if ye go silent beneath the tides. We forge this pact one step at a time — no rushin'. First up: scrawl yer memo below. I seal it inside yer own browser; the plaintext never reaches this chat nor me servers. Cross me heart, hope to drown.";

let msgSeq = 0;
function nextId(): string {
  msgSeq += 1;
  return `m${msgSeq}`;
}

/** The setup-step card to render for a state. IDLE ⇒ the MEMO card. */
function setupStep(state: ChatState): ChatState {
  return state === "IDLE" ? "MEMO" : state;
}

/** "every 2 minutes" / "every day" — a human gloss of intervalSec for the transcript. */
function humanInterval(sec: number): string {
  const units: Array<[number, string]> = [
    [604_800, "week"],
    [86_400, "day"],
    [60, "minute"],
  ];
  for (const [s, name] of units) {
    if (sec % s === 0) {
      const c = sec / s;
      return c === 1 ? `every ${name}` : `every ${c} ${name}s`;
    }
  }
  return `every ${sec}s`;
}

/** A non-secret one-liner summarizing the chosen Terms (the memo text is NEVER echoed). */
function describeTerms(t: Terms): string {
  const bulletin = t.bulletin && t.bulletin.trim() ? ", custom bulletin" : "";
  return `Terms: ${humanInterval(t.intervalSec)}, ${t.n}-rung ladder, ${t.fundingHbar} ℏ funding${bulletin}.`;
}

/** What to say when a topic URL restores an existing switch into the chat. */
function restoreSummary(v: SwitchView): string {
  const rungs = v.rungHashes.length || v.terms.n;
  if (v.status === "ACTIVE") {
    return `Ahoy, yer back! Yer pact still stands — rung ${v.liveIdx} o' ${rungs}, ${v.seq} signal(s) sent so far. I kept me eye on it the whole while. Check in below to buy more time, or sign a Ledger transfer to call it off.`;
  }
  if (v.status === "RELEASED") {
    return "Ahoy. The tides turned while ye were away — yer switch RELEASED. The chest is open to all now; haul out yer memo below.";
  }
  return "Ahoy. This pact was stood down — its ladder shredded to splinters. Naught left to reveal, matey.";
}

const STATUS_BADGE: Record<SwitchView["status"], string> = {
  ACTIVE: "badge badge--active",
  RELEASED: "badge badge--released",
  CANCELLED: "badge badge--cancelled",
};

export function Chat() {
  const [context, setContext] = useState<ChatContext>({ state: "IDLE" });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  // Defer the first render until the mount effect decides setup-vs-restore (no flash).
  const [booted, setBooted] = useState(false);

  // The captain's reactions. Stable methods only (so memoized handlers don't churn).
  const { setResting, runWhile, pulse } = usePirate();

  // Local secret artifacts — browser-memory ONLY. `memo.key` (K) and `memo.ciphertext`
  // never leave here except the ciphertext bytes uploaded to /api/storage at arm.
  const [memo, setMemo] = useState<MemoCaptured | null>(null);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [world, setWorld] = useState<WorldVerified | null>(null);
  const [signed, setSigned] = useState<LedgerSigned | null>(null);
  // The commitment salt — fixed once so the policyHash the device signs is exactly the
  // one the arm executor recomputes (policyHash omits armTime).
  const [nonce] = useState<string>(() => randomNonceHex());

  const [arming, setArming] = useState(false);
  const [topicId, setTopicId] = useState<string | null>(null);

  // The live "watcher": one poll of the public SwitchView feeds the status, check-in,
  // cancel, and reveal cards; `now` drives the countdown.
  const [view, setView] = useState<SwitchView | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  // The ACTIVE switch's bottom action bar drives which on-demand card is open beneath
  // the status: the World check-in gate, the cancel ceremony, or neither.
  const [livePanel, setLivePanel] = useState<"none" | "checkin" | "cancel">("none");

  // Keep the latest context in a ref so sequential dispatches never read a stale value.
  const ctxRef = useRef<ChatContext>(context);
  useEffect(() => {
    ctxRef.current = context;
  }, [context]);

  // The scroll log — keep it pinned to the newest message / active card.
  const logRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, context.state, busy, view?.status]);

  const pushAssistant = useCallback((text: string, links?: ChatLink[]) => {
    setMessages((prev) => [...prev, { id: nextId(), role: "assistant", text, links }]);
  }, []);
  const pushUser = useCallback((text: string) => {
    setMessages((prev) => [...prev, { id: nextId(), role: "user", text }]);
  }, []);

  // Advance the machine. /api/chat runs the SAME reduce() + supplies (optional, possibly
  // LLM-polished) narration; if it's unreachable we advance client-side and narrate
  // locally — so the flow never depends on the model OR the route. The captain shows
  // "thinking" for at least MIN_ACTION_MS, then "talks" as the new line lands.
  const dispatch = useCallback(
    async (event: ChatEvent): Promise<ChatContext> => {
      const current = ctxRef.current;
      setBusy(true);
      try {
        const next = await runWhile(
          "thinking",
          async () => {
            try {
              const res = await fetch("/api/chat", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ context: current, event }),
              });
              const data = (await res.json()) as {
                context?: ChatContext;
                narration?: string;
              };
              const n = data.context ?? reduce(current, event);
              ctxRef.current = n;
              setContext(n);
              pushAssistant(data.narration ?? narrate(n));
              return n;
            } catch {
              const n = reduce(current, event);
              ctxRef.current = n;
              setContext(n);
              pushAssistant(narrate(n));
              return n;
            }
          },
          MIN_ACTION_MS,
        );
        pulse("talking", 1500);
        return next;
      } finally {
        setBusy(false);
      }
    },
    [pushAssistant, runWhile, pulse],
  );

  // ── Step-card capture handlers — each records the (local) artifact, echoes a
  //    NON-SECRET summary into the transcript, then advances the machine. ──────────
  const onMemo = useCallback(
    (m: MemoCaptured) => {
      setMemo(m);
      pushUser("📝 Memo written and encrypted locally.");
      void dispatch({
        type: "MEMO_CAPTURED",
        ciphertextHash: m.ciphertextHash,
        storageKind: m.storageKind,
      });
    },
    [dispatch, pushUser],
  );
  const onTermsSet = useCallback(
    (t: Terms) => {
      setTerms(t);
      pushUser(describeTerms(t));
      void dispatch({ type: "TERMS_SET", terms: t });
    },
    [dispatch, pushUser],
  );
  const onWorld = useCallback(
    (v: WorldVerified) => {
      setWorld(v);
      pushUser("✅ Verified I'm a unique human (World ID).");
      void dispatch({ type: "WORLD_VERIFIED", nullifier: v.nullifier });
    },
    [dispatch, pushUser],
  );
  const onSigned = useCallback(
    (s: LedgerSigned) => {
      setSigned(s);
      pushUser(`🔏 Signed the arm transfer on my Ledger (${s.ledgerAccountId}).`);
      void dispatch({ type: "SIGNED", armTxId: s.armTxId, ledgerAccountId: s.ledgerAccountId });
    },
    [dispatch, pushUser],
  );

  // Re-poll the watched switch immediately (used after a check-in / cancel).
  const refresh = useCallback(async () => {
    if (!topicId) return;
    try {
      const res = await fetch(`/api/switch/${topicId}`, { cache: "no-store" });
      if (res.ok) setView((await res.json()) as SwitchView);
    } catch {
      /* transient — the poll loop will catch up */
    }
  }, [topicId]);

  const onCheckedIn = useCallback(
    (result: CheckinResult) => {
      pushAssistant(
        `Still breathin', I see — good on ye. I've shoved the reckonin' back to ${new Date(result.newDeadline).toUTCString()} (signal ${result.seq}, rung ${result.liveIdx}) an' burned the nearest rung. Back to me watch.`,
      );
      setLivePanel("none"); // collapse the gate back to the action bar
      void refresh();
    },
    [pushAssistant, refresh],
  );
  const onCancelled = useCallback(() => {
    pushAssistant(
      "Done — pact stood down. I've torn up the schedule an' shredded the ladder to fish bait. Yer secret sinks with me; nothin' will ever be loosed.",
    );
    setLivePanel("none");
    void refresh();
  }, [pushAssistant, refresh]);

  // The policyHash the Ledger memo commits to (over the assembled Policy).
  const policy: Policy | null =
    memo && terms && world
      ? { terms, nullifier: world.nullifier, ciphertextHash: memo.ciphertextHash, nonce }
      : null;
  const policyHashHex = policy ? computePolicyHash(policy) : "";

  // The full arm assembly, client-side: upload ciphertext, mint the ladder from K (then
  // drop K), POST a complete ArmInput + ArmArtifacts. K and plaintext never leave here.
  // The captain shows "encrypting" (sealing the chest) for at least MIN_ACTION_MS.
  async function arm() {
    if (!memo || !terms || !world || !signed || !policy) return;
    setArming(true);
    try {
      await runWhile(
        "encrypting",
        async () => {
          const up = await fetch("/api/storage", {
            method: "POST",
            headers: { "content-type": "application/octet-stream" },
            body: memo.ciphertext as BodyInit,
          });
          if (!up.ok) throw new Error(`storage failed (${up.status})`);
          const storage = (await up.json()) as StorageRef;

          const armTime = Date.now();
          const ladder = await mintLadder(memo.key, armTime, terms);

          const input: ArmInput = { policy, policyHash: policyHashHex, storage, ladder, armTime };
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
            throw new Error(
              `arm failed (${res.status})${err ? `: ${JSON.stringify(err.error)}` : ""}`,
            );
          }
          const body = (await res.json()) as { topicId: string };

          // Armed. Stay in-place: flip the machine to ARMED, watch the topic, count down.
          const armed: ChatContext = {
            ...ctxRef.current,
            state: "ARMED",
            topicId: body.topicId,
            suggestion: undefined,
            error: undefined,
          };
          ctxRef.current = armed;
          setContext(armed);
          setTopicId(body.topicId);
          enterLive(body.topicId);
        },
        MIN_ACTION_MS,
      );
    } catch (e) {
      pushAssistant(
        `Blast — I couldn't arm the pact: ${e instanceof Error ? e.message : String(e)}. Nothin' was armed, so no harm done. Patch it up an' give it another go.`,
      );
    } finally {
      setArming(false);
    }
  }

  // SPA continuity: rewrite the URL to the topic (so a reload restores this chat), then
  // post the return link + the direct status/reveal page link as a chat bubble.
  function enterLive(id: string) {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("t", id);
      window.history.replaceState(null, "", url.toString());
    }
    pushAssistant(
      `Armed an' afloat (topic ${id})! I'm countin' down to yer next deadline below. Stash this link to sail back any time — check in afore the glass runs out to push it back, or go quiet to loose the secret.`,
      [
        { label: "↩ Return to this switch (chat)", href: `/?t=${id}` },
        { label: "Status & reveal page ↗", href: `/s/${id}` },
      ],
    );
  }

  // Mount: decide setup-vs-restore from `?t=`. With a topic, re-enter the chat with the
  // switch loaded, the watcher live, and the countdown running (Phase 7 restoration).
  useEffect(() => {
    const t =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("t")
        : null;

    if (!t) {
      setMessages([{ id: nextId(), role: "assistant", text: INTRO }]);
      setBooted(true);
      return;
    }

    setTopicId(t);
    setContext({ state: "ARMED", topicId: t });
    setMessages([{ id: nextId(), role: "assistant", text: `Ahoy again — haulin' up switch ${t} from the depths…` }]);
    setBooted(true);

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/switch/${t}`, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          pushAssistant(
            res.status === 404
              ? `Hm — no sign o' topic ${t} on the charts yet. It may still be driftin' to the mirror. I'll keep a lookout below.`
              : `Rough seas loadin' topic ${t} (error ${res.status}). I'll keep tryin' below.`,
          );
          return;
        }
        const v = (await res.json()) as SwitchView;
        if (cancelled) return;
        setView(v);
        pushAssistant(restoreSummary(v), [{ label: "Status & reveal page ↗", href: `/s/${t}` }]);
      } catch {
        if (!cancelled) pushAssistant(`A squall hit loadin' ${t} — I'll keep tryin' below.`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pushAssistant]);

  // The watcher + countdown clock. Active whenever a topic is loaded (armed or restored).
  useEffect(() => {
    if (!topicId) return;
    let live = true;
    async function poll() {
      try {
        const res = await fetch(`/api/switch/${topicId}`, { cache: "no-store" });
        if (!res.ok) return; // keep the prior view; transient (e.g. mirror lag)
        const data = (await res.json()) as SwitchView;
        if (live) setView(data);
      } catch {
        /* transient */
      }
    }
    void poll();
    const pollTimer = setInterval(() => void poll(), POLL_MS);
    const tickTimer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      live = false;
      clearInterval(pollTimer);
      clearInterval(tickTimer);
    };
  }, [topicId]);

  const live = context.state === "ARMED";
  const step = setupStep(context.state);

  // The captain rests "waiting" while a setup card needs the user, and "idle" once the
  // switch is live and just being watched. Transient actions (thinking / encrypting /
  // decrypting / talking) override this while they run.
  useEffect(() => {
    if (!booted) return;
    setResting(live ? "idle" : "waiting");
  }, [booted, live, setResting]);

  if (!booted) {
    return (
      <div className="bubble">
        <div className="bubble__log">
          <div className="msg msg--note">Hoisting the colours…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="bubble">
      <div className="bubble__head">
        <img className="bubble__avatar" src="/posters/idle.png" alt="" />
        <div className="bubble__id">
          <div className="bubble__name">Cap&apos;n Mordecai Graves</div>
          <div className="bubble__role">
            {live ? "Keeping watch over yer pact" : "Keeper of the Deadman's Pact"}
          </div>
        </div>
        <div className="bubble__head-aside">
          {live ? (
            view ? (
              <span className={STATUS_BADGE[view.status]}>{view.status}</span>
            ) : (
              <span className="badge badge--loading">loading</span>
            )
          ) : (
            <StepIndicator state={context.state} />
          )}
        </div>
      </div>

      <div className="bubble__log thin-scroll" ref={logRef}>
        <MessageList messages={messages} />
        {/* The active step / live card renders INLINE at the bottom of the scroll — the
            one place an artifact is captured and the one place the live switch is acted on. */}
        <div className="bubble__cards">{renderActiveCard()}</div>
      </div>

      {/* The ACTIVE switch's bottom action bar: a large primary "Check in" (summons the
          World check-in gate) and a secondary "Terminate" (summons the cancel ceremony).
          Each toggles its card open/closed above; both vanish once the switch is terminal. */}
      {live && view && view.status === "ACTIVE" ? (
        <div className="bubble__actions">
          <button
            type="button"
            className={`btn btn--gold btn--lg bubble__actions-primary${livePanel === "checkin" ? " is-on" : ""}`}
            aria-pressed={livePanel === "checkin"}
            onClick={() => setLivePanel((p) => (p === "checkin" ? "none" : "checkin"))}
          >
            ✋ Check in
          </button>
          <button
            type="button"
            className={`btn btn--danger-ghost${livePanel === "cancel" ? " is-on" : ""}`}
            aria-pressed={livePanel === "cancel"}
            onClick={() => setLivePanel((p) => (p === "cancel" ? "none" : "cancel"))}
          >
            Terminate
          </button>
        </div>
      ) : null}
    </div>
  );

  function renderActiveCard() {
    if (live) {
      if (!topicId) {
        return (
          <div className="compose compose--ok">
            <p className="compose__tag">⚓ Pact armed — keeping watch</p>
          </div>
        );
      }
      return (
        <>
          <StatusCard topicId={topicId} view={view} now={now} />
          {/* On an ACTIVE switch the check-in gate / cancel ceremony are summoned on
              demand by the bottom action bar (below) — not shown by default. */}
          {view && view.status === "ACTIVE" ? (
            <>
              {livePanel === "checkin" ? (
                <CheckinCard view={view} onCheckedIn={onCheckedIn} />
              ) : null}
              {livePanel === "cancel" ? (
                <SwitchActions view={view} onRefresh={onCancelled} />
              ) : null}
            </>
          ) : null}
          {/* Reveal only matters once terminal (released → reveal; cancelled → notice). */}
          {view && view.status !== "ACTIVE" ? <RevealCard view={view} /> : null}
        </>
      );
    }

    switch (step) {
      case "MEMO":
        return <MemoCard onCaptured={onMemo} />;
      case "TERMS":
        return <TermsChips onTerms={onTermsSet} suggestion={context.suggestion?.terms} />;
      case "WORLD":
        return (
          <WorldVerifyCard
            signal={memo?.ciphertextHash ?? ""}
            environment={WORLD_ENV}
            onVerified={onWorld}
          />
        );
      case "SIGN":
        return (
          <>
            <LedgerSignCard
              policyHash={policyHashHex}
              fundingHbar={terms?.fundingHbar ?? 0}
              onSigned={onSigned}
            />
            {signed ? (
              <button
                type="button"
                disabled={arming}
                onClick={arm}
                className="btn btn--gold w-full"
              >
                {arming ? "Sealin' the pact…" : "⚓ Arm the pact"}
              </button>
            ) : null}
          </>
        );
      default:
        return null;
    }
  }
}
