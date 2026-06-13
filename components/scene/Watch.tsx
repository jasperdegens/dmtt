"use client";

// components/scene/Watch.tsx — the ambient "the Pact is watching" clock, bottom-left.
//
// Self-contained: it reads the topic from the `?t=` URL (set by the chat once a switch
// is armed) and independently polls the PUBLIC SwitchView for the live countdown to the
// next deadline. With no topic it shows a quiet keeping-watch state, so the corner is
// never empty during setup. Read-only — it never mutates anything.

import { useEffect, useState } from "react";
import type { SwitchView } from "@/lib/types.ts";

const POLL_MS = 12_000;

function topicFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("t");
}

/** h/m/s split of a positive ms span (clamped at zero). */
function hms(ms: number): { h: string; m: string; s: string } {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    h: String(Math.floor(total / 3600)).padStart(2, "0"),
    m: String(Math.floor((total % 3600) / 60)).padStart(2, "0"),
    s: String(total % 60).padStart(2, "0"),
  };
}

export function Watch() {
  const [topicId, setTopicId] = useState<string | null>(null);
  const [view, setView] = useState<SwitchView | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Track the topic from the URL (mount + on history changes the chat makes).
  useEffect(() => {
    const sync = () => setTopicId(topicFromUrl());
    sync();
    window.addEventListener("popstate", sync);
    const id = setInterval(sync, 3000); // catch replaceState after arm
    return () => {
      window.removeEventListener("popstate", sync);
      clearInterval(id);
    };
  }, []);

  // Poll the public view + tick the clock whenever a topic is loaded.
  useEffect(() => {
    if (!topicId) {
      setView(null);
      return;
    }
    let live = true;
    async function poll() {
      try {
        const res = await fetch(`/api/switch/${topicId}`, { cache: "no-store" });
        if (res.ok && live) setView((await res.json()) as SwitchView);
      } catch {
        /* transient — keep the prior view */
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

  // Idle (setup): a quiet keeping-watch indicator so the corner is never empty.
  if (!topicId || !view) {
    return (
      <div className="watch" title="The Pact keeps watch.">
        <span className="watch__dot watch__dot--grey" />
        <div>
          <div className="watch__label">The Pact</div>
          <div className="watch__time" style={{ fontSize: "1.05rem" }}>
            keeping watch
          </div>
        </div>
      </div>
    );
  }

  if (view.status === "ACTIVE" && view.currentDeadline !== null) {
    const { h, m, s } = hms(view.currentDeadline - now);
    const overdue = view.currentDeadline - now <= 0;
    return (
      <div
        className="watch"
        title="Signal before the tide runs out — check in to postpone."
      >
        <span className={`watch__dot${overdue ? " watch__dot--amber" : ""}`} />
        <div>
          <div className="watch__label">
            {overdue ? "Tide has turned" : "Next signal due in"}
          </div>
          <div className="watch__time">
            {h}
            <small>h </small>
            {m}
            <small>m </small>
            {s}
            <small>s</small>
          </div>
        </div>
      </div>
    );
  }

  // Terminal states — released or stood down.
  const released = view.status === "RELEASED";
  return (
    <div className="watch">
      <span className={`watch__dot ${released ? "watch__dot--amber" : "watch__dot--grey"}`} />
      <div>
        <div className="watch__label">{released ? "The Pact" : "Stood down"}</div>
        <div className="watch__time" style={{ fontSize: "1.05rem" }}>
          {released ? "delivered" : "cancelled"}
        </div>
      </div>
    </div>
  );
}
