"use client";

// components/Chat.tsx — the chat shell (WS-E).
//
// A hand-rolled, AI-Elements-style shell (no shadcn registry, no `npx ai-elements`):
// a step indicator + a message transcript + a slot where the ACTIVE step card renders
// + a free-text input. The chat is a FIXED state machine: this shell holds the
// ChatContext and posts CAPTURED ARTIFACT events to /api/chat, which runs reduce()
// server-side and returns the next context + a narration. The LLM only narrates.
//
// Two hard invariants are enforced here:
//   1. The text input is DISABLED while the MEMO step is active — plaintext must NOT
//      transit chat; the memo is captured + encrypted by the MemoCard (rendered into
//      the `activeCard` slot, owned by WS-F).
//   2. Free text only ever produces a PARSE_TEXT chip PROPOSAL — it can never move a
//      step or arm. Steps advance only when a card hands back an artifact via
//      `applyEvent` (passed to the slot render-prop).

import { useCallback, useMemo, useState, type ReactNode } from "react";

import type { ChatContext, ChatEvent, ChatState } from "@/lib/chat-machine.ts";
import { MessageList } from "./chat/MessageList.tsx";
import { StepIndicator } from "./chat/StepIndicator.tsx";
import { ChatInput } from "./chat/ChatInput.tsx";
import type { ChatMessage } from "./chat/types.ts";

let msgSeq = 0;
function nextId(): string {
  msgSeq += 1;
  return `m${msgSeq}`;
}

/** The setup-step the active card slot should render for. IDLE ⇒ the MEMO card. */
function cardStep(state: ChatState): ChatState {
  return state === "IDLE" ? "MEMO" : state;
}

export interface ChatProps {
  /** Render the active step's card (MemoCard/TermsChips/WorldVerifyCard/LedgerSignCard,
   *  owned by WS-F). Receives the current context + `applyEvent` so a captured artifact
   *  advances the machine. Rendered as a slot to avoid a hard import dependency. */
  activeCard?: (args: {
    step: ChatState;
    context: ChatContext;
    applyEvent: (event: ChatEvent) => void;
  }) => ReactNode;
  /** Optional initial context (defaults to a fresh IDLE machine). */
  initialContext?: ChatContext;
}

export function Chat({ activeCard, initialContext }: ChatProps) {
  const [context, setContext] = useState<ChatContext>(initialContext ?? { state: "IDLE" });
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: nextId(),
      role: "assistant",
      text: "Let's set up your switch. First, write the memo — it's encrypted in your browser before anything leaves your device.",
    },
  ]);
  const [busy, setBusy] = useState(false);

  // Post an event to /api/chat (the server runs reduce()) and fold the result in.
  const post = useCallback(async (event: ChatEvent, current: ChatContext) => {
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ context: current, event }),
      });
      const data = (await res.json()) as { context?: ChatContext; narration?: string };
      if (data.context) setContext(data.context);
      if (data.narration) {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "assistant", text: data.narration as string },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "system", text: "Network hiccup — try again." },
      ]);
    } finally {
      setBusy(false);
    }
  }, []);

  // A card captured an artifact → advance the machine. Cards call this; free text
  // cannot (it can only PARSE_TEXT for a proposal, never synthesize an artifact).
  const applyEvent = useCallback(
    (event: ChatEvent) => {
      void post(event, context);
    },
    [post, context],
  );

  // Free text → a PARSE_TEXT proposal ONLY (the server attaches a transient chip; the
  // step never moves). Echo the user's line so the transcript reflects it.
  const onSend = useCallback(
    (text: string) => {
      setMessages((prev) => [...prev, { id: nextId(), role: "user", text }]);
      void post({ type: "PARSE_TEXT", text }, context);
    },
    [post, context],
  );

  const step = cardStep(context.state);
  // Invariant #1: the memo step disables the text box (plaintext must not transit chat).
  const inputDisabled = step === "MEMO" || busy;
  const disabledReason =
    step === "MEMO"
      ? "The memo is encrypted in your browser — it never goes through chat. Use the card above."
      : busy
        ? "Working…"
        : undefined;

  const slot = useMemo(
    () => activeCard?.({ step, context, applyEvent }),
    [activeCard, step, context, applyEvent],
  );

  return (
    <div className="flex h-full flex-col gap-4">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-200">Set up your switch</h2>
        <StepIndicator state={context.state} />
      </header>

      <div className="flex-1 overflow-y-auto">
        <MessageList messages={messages} />
      </div>

      {/* The active step card renders here (WS-F). It is the ONLY way to capture an
          artifact and advance the machine. */}
      {slot ? <div className="mt-2">{slot}</div> : null}

      {context.suggestion && context.suggestion.kind !== "unknown" ? (
        <p className="text-xs text-neutral-400">
          Suggestion: {context.suggestion.note ?? context.suggestion.kind} — accept it on the
          card above to apply.
        </p>
      ) : null}

      <ChatInput disabled={inputDisabled} disabledReason={disabledReason} onSend={onSend} />
    </div>
  );
}
