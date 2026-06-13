"use client";

// components/chat/MessageList.tsx — the scrolling transcript (WS-E), styled as the
// captain's log: his lines on parchment, yours on a red ribbon.
//
// The captain's lines STREAM in — he "writes" them out a few characters at a time with a
// blinking caret, the way a speaker reels off a sentence — then settle on the full line.
// Your lines and system notes appear at once. Presentational only: the LLM only ever
// narrates here; it cannot move the machine (that's the step cards' artifacts). The parent
// (.bubble__log) owns scrolling; the typewriter nudges it to the bottom as it grows.

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "./types.ts";

/** Reveal `text` progressively (typewriter). Each message animates once on mount (keyed by
 *  id upstream). The reveal is time-bounded — longer lines surface more characters per tick
 *  — so it always finishes briskly. Keeps the freshest text in view while it streams. */
function Typewriter({ text }: { text: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    setCount(0);
    const step = Math.max(1, Math.ceil(text.length / 70)); // ~70 ticks total, any length
    let i = 0;
    const id = setInterval(() => {
      i = Math.min(text.length, i + step);
      setCount(i);
      ref.current?.closest(".bubble__log")?.scrollTo({ top: 1e9 });
      if (i >= text.length) clearInterval(id);
    }, 26);
    return () => clearInterval(id);
  }, [text]);

  const done = count >= text.length;
  return (
    <span ref={ref}>
      {text.slice(0, count)}
      {!done ? (
        <span className="msg__caret" aria-hidden="true">
          ▍
        </span>
      ) : null}
    </span>
  );
}

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
          {m.role === "assistant" ? <Typewriter text={m.text} /> : m.text}
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
