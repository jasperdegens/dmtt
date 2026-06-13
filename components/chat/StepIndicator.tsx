"use client";

// components/chat/StepIndicator.tsx — the fixed step ladder (WS-E).
//
// Renders IDLE → MEMO → TERMS → WORLD → SIGN → ARMED with the current step
// highlighted and completed steps checked. Purely presentational — the order is
// fixed (the machine never reorders), so this just reflects ctx.state.

import type { ChatState } from "@/lib/chat-machine.ts";
import { STEP_ORDER, STEP_LABEL } from "./types.ts";

// The setup step the machine is "on" given its state. MEMO is implied when the
// machine is still IDLE (no memo captured yet); post-arm branches show ARMED.
function activeStep(state: ChatState): ChatState {
  if (state === "IDLE") return "MEMO";
  if (state === "CHECKIN" || state === "CANCEL") return "ARMED";
  return state;
}

export function StepIndicator({ state }: { state: ChatState }) {
  const active = activeStep(state);
  const activeIdx = STEP_ORDER.indexOf(active);

  return (
    <ol className="flex items-center gap-1 text-xs" aria-label="Setup progress">
      {STEP_ORDER.filter((s) => s !== "IDLE").map((step) => {
        const idx = STEP_ORDER.indexOf(step);
        const done = idx < activeIdx;
        const current = idx === activeIdx;
        return (
          <li
            key={step}
            className={[
              "rounded-full px-2.5 py-1",
              current
                ? "bg-emerald-600 text-white"
                : done
                  ? "bg-emerald-900/40 text-emerald-300"
                  : "bg-neutral-800 text-neutral-500",
            ].join(" ")}
            aria-current={current ? "step" : undefined}
          >
            {done ? "✓ " : ""}
            {STEP_LABEL[step]}
          </li>
        );
      })}
    </ol>
  );
}
