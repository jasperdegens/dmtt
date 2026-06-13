"use client";

// StatusCard — live status of an armed switch (CONTRACTS §9). Polls the PUBLIC
// SwitchView at GET /api/switch/[topicId] (never the agent-private Switch — N10),
// and renders status, the liveIdx/seq pointer, a countdown to currentDeadline, and
// HashScan links. The view is the consensus-ordered audit trail; we only read it.

import { useEffect, useState } from "react";
import type { SwitchView } from "@/lib/types.ts";

const POLL_MS = 10_000;

function hashscanTopic(topicId: string): string {
  return `https://hashscan.io/testnet/topic/${topicId}`;
}

/** Coarse human countdown to a unix-ms deadline (or "now" once it's passed). */
function countdown(deadlineMs: number, nowMs: number): string {
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
  ACTIVE: "bg-emerald-900 text-emerald-300",
  RELEASED: "bg-amber-900 text-amber-300",
  CANCELLED: "bg-neutral-800 text-neutral-400",
};

export function StatusCard({ topicId }: { topicId: string }) {
  const [view, setView] = useState<SwitchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    let live = true;

    async function poll() {
      try {
        const res = await fetch(`/api/switch/${topicId}`, { cache: "no-store" });
        if (!res.ok) {
          if (live) {
            setError(res.status === 404 ? "No such switch." : `Error ${res.status}`);
            setView(null);
          }
          return;
        }
        const data = (await res.json()) as SwitchView;
        if (live) {
          setView(data);
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
    const tickTimer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      live = false;
      clearInterval(pollTimer);
      clearInterval(tickTimer);
    };
  }, [topicId]);

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Switch status</h2>
        {view ? (
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[view.status]}`}
          >
            {view.status}
          </span>
        ) : null}
      </div>

      <p className="mt-1 break-all font-mono text-xs text-neutral-500">{topicId}</p>

      {loading && !view ? (
        <p className="mt-4 text-sm text-neutral-400">Loading…</p>
      ) : null}

      {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}

      {view ? (
        <div className="mt-4 space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-neutral-500">Live rung</div>
              <div className="font-mono">
                {view.liveIdx} / {view.rungHashes.length || view.terms.n}
              </div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">Check-ins (seq)</div>
              <div className="font-mono">{view.seq}</div>
            </div>
          </div>

          <div>
            <div className="text-xs text-neutral-500">Next deadline</div>
            <div className="font-mono">
              {view.currentDeadline === null
                ? "—"
                : `${countdown(view.currentDeadline, now)} · ${new Date(view.currentDeadline).toUTCString()}`}
            </div>
          </div>

          <div className="border-t border-neutral-800 pt-3">
            <div className="text-xs text-neutral-500">Audit trail</div>
            <ul className="mt-1 space-y-0.5 font-mono text-xs text-neutral-400">
              {view.events.length === 0 ? (
                <li className="text-neutral-600">no events yet</li>
              ) : (
                view.events.map((e, i) => <li key={i}>· {e.type}</li>)
              )}
            </ul>
          </div>

          <a
            href={hashscanTopic(view.topicId)}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-xs text-emerald-400 underline"
          >
            View topic on HashScan ↗
          </a>
        </div>
      ) : null}
    </div>
  );
}
