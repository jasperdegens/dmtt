"use client";

// TermsChips — choose the release Terms (CONTRACTS §1): postpone cadence, ladder
// length N, FUNDING, and the public bulletin. Emits a Terms once confirmed; these
// are bound into policyHash at arm, so they're locked from that point.

import { useEffect, useState } from "react";
import { LADDER_N, type Terms } from "@/lib/types.ts";

const INTERVAL_UNITS = [
  { label: "Minute", unit: "minute", seconds: 60 },
  { label: "Day", unit: "day", seconds: 86_400 },
  { label: "Week", unit: "week", seconds: 604_800 },
] as const;
type IntervalUnit = (typeof INTERVAL_UNITS)[number]["unit"];

const DEFAULT_FUNDING_HBAR = 0.1;
const MIN_FUNDING_HBAR = 0.1;

/** Render an intervalSec back to the count+unit chips (largest unit that divides it). */
function secToCountUnit(sec: number): { count: number; unit: IntervalUnit } {
  for (const u of [...INTERVAL_UNITS].reverse()) {
    if (sec % u.seconds === 0) return { count: sec / u.seconds, unit: u.unit };
  }
  return { count: Math.max(1, Math.round(sec / 60)), unit: "minute" };
}

export function TermsChips({
  onTerms,
  suggestion,
}: {
  onTerms: (terms: Terms) => void;
  /** A free-text chip proposal (e.g. "2 minutes", "0.1 hbar") to prefill the fields with.
   *  Free text never sets the Terms directly — it only fills the card, which the user
   *  still confirms (CLAUDE.md: the machine advances on captured artifacts, not text). */
  suggestion?: Partial<Terms>;
}) {
  const [intervalCount, setIntervalCount] = useState<number>(1);
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>("minute");
  const [n, setN] = useState<number>(LADDER_N);
  const [fundingHbar, setFundingHbar] = useState<number>(DEFAULT_FUNDING_HBAR);
  const [bulletin, setBulletin] = useState<string>("");
  const selectedUnit = INTERVAL_UNITS.find((u) => u.unit === intervalUnit) ?? INTERVAL_UNITS[0];
  const intervalSec = intervalCount * selectedUnit.seconds;

  // Apply an incoming free-text proposal to the relevant field(s). Each PARSE_TEXT is a
  // fresh object, so this re-runs per suggestion; the user still presses confirm.
  useEffect(() => {
    if (!suggestion) return;
    if (typeof suggestion.intervalSec === "number" && suggestion.intervalSec > 0) {
      const { count, unit } = secToCountUnit(suggestion.intervalSec);
      setIntervalCount(count);
      setIntervalUnit(unit);
    }
    if (typeof suggestion.fundingHbar === "number" && suggestion.fundingHbar > 0) {
      setFundingHbar(Math.max(MIN_FUNDING_HBAR, suggestion.fundingHbar));
    }
    if (typeof suggestion.n === "number" && suggestion.n > 0) {
      setN(Math.min(LADDER_N, Math.max(1, suggestion.n)));
    }
    if (typeof suggestion.bulletin === "string") setBulletin(suggestion.bulletin);
  }, [suggestion]);

  return (
    <div className="panel p-5">
      <h2 className="panel-title">Release terms</h2>
      <p className="panel-note mt-1 text-xs">
        Check in once per interval to postpone. Go silent for one full interval and the
        network releases your memo.
      </p>

      <div className="mt-4">
        <label className="muted text-xs font-medium">Check-in cadence</label>
        <div className="mt-2 grid grid-cols-[minmax(5rem,8rem)_1fr] gap-2">
          <input
            type="number"
            min={1}
            step={1}
            value={intervalCount}
            onChange={(e) => setIntervalCount(Math.max(1, Number(e.target.value) || 1))}
            className="field"
          />
          <div className="flex flex-wrap gap-2">
            {INTERVAL_UNITS.map((u) => (
              <button
                key={u.unit}
                type="button"
                onClick={() => setIntervalUnit(u.unit)}
                className={intervalUnit === u.unit ? "tab tab--active" : "tab"}
              >
                {u.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <label className="muted text-xs font-medium">Ladder length (N)</label>
          <input
            type="number"
            min={1}
            max={20}
            value={n}
            onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))}
            className="field mt-1"
          />
        </div>
        <div>
          <label className="muted text-xs font-medium">Funding (ℏ)</label>
          <input
            type="number"
            min={MIN_FUNDING_HBAR}
            step={0.1}
            value={fundingHbar}
            onChange={(e) =>
              setFundingHbar(
                Math.max(MIN_FUNDING_HBAR, Number(e.target.value) || MIN_FUNDING_HBAR),
              )
            }
            className="field mt-1"
          />
        </div>
      </div>

      <div className="mt-4">
        <label className="muted text-xs font-medium">Public bulletin (posted at release)</label>
        <textarea
          value={bulletin}
          onChange={(e) => setBulletin(e.target.value)}
          rows={2}
          placeholder="A. has gone silent. The enclosed memo is now public…"
          className="field mt-1 resize-y"
        />
      </div>

      <button
        type="button"
        onClick={() => onTerms({ intervalSec, n, fundingHbar, bulletin })}
        className="btn btn--gold mt-4 w-full"
      >
        Set terms &amp; continue
      </button>
    </div>
  );
}
