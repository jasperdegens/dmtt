"use client";

// TermsChips — choose the release Terms (CONTRACTS §1): postpone cadence, ladder
// length N, FUNDING, and the public bulletin. Emits a Terms once confirmed; these
// are bound into policyHash at arm, so they're locked from that point.

import { useState } from "react";
import { LADDER_N, type Terms } from "@/lib/types.ts";

const CADENCES = [
  { label: "Daily", intervalSec: 86_400 },
  { label: "Weekly", intervalSec: 604_800 },
  { label: "Monthly", intervalSec: 2_592_000 },
] as const;

export function TermsChips({ onTerms }: { onTerms: (terms: Terms) => void }) {
  const [intervalSec, setIntervalSec] = useState<number>(CADENCES[0].intervalSec);
  const [n, setN] = useState<number>(LADDER_N);
  const [fundingHbar, setFundingHbar] = useState<number>(50);
  const [bulletin, setBulletin] = useState<string>("");

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
      <h2 className="text-lg font-semibold">Release terms</h2>
      <p className="mt-1 text-xs text-neutral-400">
        Check in once per interval to postpone. Go silent for one full interval and the
        network releases your memo.
      </p>

      <div className="mt-4">
        <label className="text-xs font-medium text-neutral-400">Check-in cadence</label>
        <div className="mt-2 flex gap-2">
          {CADENCES.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => setIntervalSec(c.intervalSec)}
              className={`rounded-full px-3 py-1.5 text-sm ${intervalSec === c.intervalSec ? "bg-emerald-600 text-white" : "bg-neutral-800 text-neutral-300"}`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-neutral-400">
            Ladder length (N)
          </label>
          <input
            type="number"
            min={1}
            max={20}
            value={n}
            onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))}
            className="mt-1 w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-600"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-neutral-400">Funding (ℏ)</label>
          <input
            type="number"
            min={1}
            value={fundingHbar}
            onChange={(e) =>
              setFundingHbar(Math.max(1, Number(e.target.value) || 1))
            }
            className="mt-1 w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-600"
          />
        </div>
      </div>

      <div className="mt-4">
        <label className="text-xs font-medium text-neutral-400">
          Public bulletin (posted at release)
        </label>
        <textarea
          value={bulletin}
          onChange={(e) => setBulletin(e.target.value)}
          rows={2}
          placeholder="A. has gone silent. The enclosed memo is now public…"
          className="mt-1 w-full resize-y rounded-md border border-neutral-800 bg-neutral-900 p-2 text-sm text-neutral-100 outline-none focus:border-neutral-600"
        />
      </div>

      <button
        type="button"
        onClick={() => onTerms({ intervalSec, n, fundingHbar, bulletin })}
        className="mt-4 w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white"
      >
        Set terms & continue
      </button>
    </div>
  );
}
