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
              "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm leading-relaxed",
              m.role === "user"
                ? "bg-emerald-600 text-white"
                : m.role === "assistant"
                  ? "bg-neutral-800 text-neutral-100"
                  : "bg-transparent text-neutral-400 italic",
            ].join(" ")}
          >
            {m.text}
            {m.links && m.links.length > 0 ? (
              <span className="mt-2 flex flex-col gap-1">
                {m.links.map((l) => (
                  <a
                    key={l.href + l.label}
                    href={l.href}
                    className="break-all font-medium text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
                  >
                    {l.label}
                  </a>
                ))}
              </span>
            ) : null}
          </div>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
