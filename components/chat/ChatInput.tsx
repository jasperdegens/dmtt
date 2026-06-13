"use client";

// components/chat/ChatInput.tsx — the free-text box (WS-E).
//
// HARD INVARIANT (CLAUDE.md): plaintext must NOT transit chat. The input is DISABLED
// while the MEMO step is active (the MemoCard owns the secret and encrypts it locally);
// the box only ever submits free text → a PARSE_TEXT chip PROPOSAL, never the memo and
// never an artifact. When disabled it shows why.

import { useState } from "react";

export function ChatInput({
  disabled,
  disabledReason,
  onSend,
}: {
  disabled: boolean;
  disabledReason?: string;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");

  function submit() {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText("");
  }

  return (
    <div className="border-t border-neutral-800 pt-3">
      {disabled ? (
        <p className="mb-2 text-xs text-amber-400">
          {disabledReason ?? "Chat is paused for this step."}
        </p>
      ) : null}
      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={disabled ? "Paused — use the card above" : 'e.g. "weekly", "50 hbar"…'}
          className="flex-1 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled}
          className="rounded-md bg-neutral-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
