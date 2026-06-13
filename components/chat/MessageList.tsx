"use client";

// components/chat/MessageList.tsx — the scrolling transcript (WS-E).
//
// Presentational only: renders the narration/user messages. The LLM only ever
// narrates here; it cannot move the machine (that's the step cards' artifacts).

import { useEffect, useRef } from "react";
import type { ChatMessage } from "./types.ts";

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  return (
    <div className="flex flex-col gap-3 overflow-y-auto" role="log" aria-live="polite">
      {messages.map((m) => (
        <div
          key={m.id}
          className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
        >
          <div
            className={[
              "max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed",
              m.role === "user"
                ? "bg-emerald-600 text-white"
                : m.role === "assistant"
                  ? "bg-neutral-800 text-neutral-100"
                  : "bg-transparent text-neutral-400 italic",
            ].join(" ")}
          >
            {m.text}
          </div>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
