"use client";

// components/chat/ChatInput.tsx — the free-text box (WS-E), styled as the bubble's
// "speak yer mind" bar.
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
    <div className="bubble__form">
      {disabled && disabledReason ? <p className="bubble__foot">{disabledReason}</p> : null}
      <div className="bubble__form-row">
        <input
          type="text"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={disabled ? "Paused — use the card above" : 'e.g. "2 minutes", "0.1 hbar"…'}
          className="field disabled:opacity-50"
        />
        <button type="button" onClick={submit} disabled={disabled} className="btn btn--gold">
          Hail
        </button>
      </div>
    </div>
  );
}
