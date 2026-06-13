"use client";

// components/chat/MessageList.tsx — the scrolling transcript (WS-E), styled as the
// captain's log: his lines on parchment, yours on a red ribbon.
//
// Presentational only: renders the narration/user messages. The LLM only ever
// narrates here; it cannot move the machine (that's the step cards' artifacts).
// The parent (.bubble__log) owns scrolling so the active card stays in view.

import type { ChatMessage } from "./types.ts";

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="flex flex-col gap-2.5" role="log" aria-live="polite">
      {messages.map((m) => (
        <div
          key={m.id}
          className={[
            "msg",
            m.role === "user" ? "msg--me" : m.role === "assistant" ? "msg--cap" : "msg--note",
          ].join(" ")}
        >
          {m.text}
          {m.links && m.links.length > 0 ? (
            <span className="mt-2 flex flex-col gap-1">
              {m.links.map((l) => (
                <a key={l.href + l.label} href={l.href} className="gold-link break-all text-sm font-medium">
                  {l.label}
                </a>
              ))}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
