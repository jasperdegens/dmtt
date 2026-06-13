"use client";

// StatusCard — live status of an armed switch (CONTRACTS §9). Renders status, the
// liveIdx/seq pointer, a countdown to currentDeadline, and HashScan links from the
// PUBLIC SwitchView (never the agent-private Switch — N10).
//
// Two modes:
//  - UNCONTROLLED (default, the /s/[topicId] route): self-polls GET /api/switch/[topicId]
//    every POLL_MS and ticks its own countdown clock.
//  - CONTROLLED (the chat live panel): the parent already watches the topic (one poll
//    feeds StatusCard + CheckinCard + SwitchActions + RevealCard), so it injects `view`
//    and `now` and StatusCard renders them without a second poll loop.

import { useEffect, useState } from "react";
import type { SwitchView } from "@/lib/types.ts";

const POLL_MS = 10_000;

export function hashscanTopic(topicId: string): string {
  return `https://hashscan.io/testnet/topic/${topicId}`;
}

/** Coarse human countdown to a unix-ms deadline (or "now" once it's passed). */
export function countdown(deadlineMs: number, nowMs: number): string {
  const ms = deadlineMs - nowMs;
  if (ms <= 0) return "deadline passed — release imminent";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  return `${m}m ${sec}s`;
}

const STATUS_STYLE: Record<SwitchView["status"], string> = {
  ACTIVE: "badge badge--active",
  RELEASED: "badge badge--released",
  CANCELLED: "badge badge--cancelled",
};

export function StatusCard({
  topicId,
  view: controlledView,
  now: controlledNow,
}: {
  topicId: string;
  /** Controlled mode: when provided (incl. null while loading), StatusCard renders this
   *  instead of self-polling. The chat live panel owns the single poll. */
  view?: SwitchView | null;
  /** Controlled clock for the countdown (pairs with `view`). */
  now?: number;
}) {
  const controlled = controlledView !== undefined;

  const [polledView, setPolledView] = useState<SwitchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [polledNow, setPolledNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (controlled) return; // parent owns the poll; don't open a second loop.
    let live = true;

    async function poll() {
      try {
        const res = await fetch(`/api/switch/${topicId}`, { cache: "no-store" });
        if (!res.ok) {
          if (live) {
            setError(res.status === 404 ? "No such switch." : `Error ${res.status}`);
            setPolledView(null);
          }
          return;
        }
        const data = (await res.json()) as SwitchView;
        if (live) {
          setPolledView(data);
          setError(null);
        }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (live) setLoading(false);
      }
    }

    poll();
    const pollTimer = setInterval(poll, POLL_MS);
    const tickTimer = setInterval(() => setPolledNow(Date.now()), 1000);
    return () => {
      live = false;
      clearInterval(pollTimer);
      clearInterval(tickTimer);
    };
  }, [topicId, controlled]);

  const view = controlled ? controlledView ?? null : polledView;
  const now = controlled ? controlledNow ?? Date.now() : polledNow;
  // In controlled mode the parent surfaces its own load/error; here we only show the
  // pre-first-view "Loading…" hint when no view has arrived yet.
  const showLoading = controlled ? view === null : loading && !view;

  const total = view ? view.rungHashes.length || view.terms.n : 0;

  return (
    <div className="compose">
      <div className="status-line">
        <span>Your pact</span>
        {view ? (
          <span className={STATUS_STYLE[view.status]}>{view.status}</span>
        ) : (
          <span className="badge badge--loading">loading</span>
        )}
      </div>

      {showLoading ? <p className="compose__lead">Scryin’ the mirror…</p> : null}
      {error ? <p className="compose__err">{error}</p> : null}

      {view ? (
        <>
          <div className="status-grid">
            <div>
              <span>Next signal</span>
              <b>{view.currentDeadline === null ? "—" : countdown(view.currentDeadline, now)}</b>
            </div>
            <div>
              <span>Rung</span>
              <b>
                {view.liveIdx}/{total}
              </b>
            </div>
            <div>
              <span>Check-ins</span>
              <b>{view.seq}</b>
            </div>
          </div>

          {view.currentDeadline !== null ? (
            <p className="compose__note">Deadline: {new Date(view.currentDeadline).toUTCString()}</p>
          ) : null}

          <details className="peek">
            <summary>Audit trail · {view.events.length}</summary>
            <ul className="peek__body mt-2 space-y-0.5">
              {view.events.length === 0 ? (
                <li className="opacity-60">no events yet</li>
              ) : (
                view.events.map((e, i) => <li key={i}>· {e.type}</li>)
              )}
            </ul>
          </details>

          <a
            href={hashscanTopic(view.topicId)}
            target="_blank"
            rel="noreferrer"
            className="gold-link text-xs"
          >
            View topic on HashScan ↗
          </a>
        </>
      ) : null}
    </div>
  );
}
