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
  // The common path is one tap on a cadence chip; everything else (count, ladder length,
  // funding, bulletin) is sensible-by-default and tucked behind this disclosure.
  const [showFinePrint, setShowFinePrint] = useState<boolean>(false);
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

  const cadenceLabel = `every ${intervalCount > 1 ? `${intervalCount} ` : ""}${selectedUnit.label.toLowerCase()}${intervalCount > 1 ? "s" : ""}`;

  return (
    <div className="compose">
      {/* The common path: one tap picks the cadence (count defaults to 1). */}
      <p className="compose__tag">⏳ How often will you check in?</p>
      <div className="compose__chips">
        {INTERVAL_UNITS.map((u) => {
          const active = intervalUnit === u.unit && intervalCount === 1;
          return (
            <button
              key={u.unit}
              type="button"
              onClick={() => {
                setIntervalUnit(u.unit);
                setIntervalCount(1);
              }}
              className={active ? "qchip qchip--active" : "qchip"}
            >
              Every {u.label.toLowerCase()}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="disclosure"
        onClick={() => setShowFinePrint((v) => !v)}
        aria-expanded={showFinePrint}
      >
        {showFinePrint ? "▾ Hide the fine print" : "▸ Tweak the fine print"}
      </button>

      {showFinePrint ? (
        <div className="compose__grid">
          <label className="compose__field">
            <span>Check in every</span>
            <span className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                step={1}
                value={intervalCount}
                onChange={(e) => setIntervalCount(Math.max(1, Number(e.target.value) || 1))}
                className="field"
              />
              <span className="muted text-xs">
                {selectedUnit.label.toLowerCase()}
                {intervalCount > 1 ? "s" : ""}
              </span>
            </span>
          </label>
          <label className="compose__field">
            <span>Ladder rungs (N)</span>
            <input
              type="number"
              min={1}
              max={20}
              value={n}
              onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))}
              className="field"
            />
          </label>
          <label className="compose__field">
            <span>Funding (ℏ)</span>
            <input
              type="number"
              min={MIN_FUNDING_HBAR}
              step={0.1}
              value={fundingHbar}
              onChange={(e) =>
                setFundingHbar(Math.max(MIN_FUNDING_HBAR, Number(e.target.value) || MIN_FUNDING_HBAR))
              }
              className="field"
            />
          </label>
          <label className="compose__field compose__field--wide">
            <span>Public bulletin (posted at release)</span>
            <textarea
              value={bulletin}
              onChange={(e) => setBulletin(e.target.value)}
              rows={2}
              placeholder="A. has gone silent. The enclosed memo is now public…"
              className="field resize-y"
            />
          </label>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => onTerms({ intervalSec, n, fundingHbar, bulletin })}
        className="btn btn--gold w-full"
      >
        Lock in — check {cadenceLabel} ⚓
      </button>
    </div>
  );
}
