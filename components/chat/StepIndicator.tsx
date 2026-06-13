"use client";

// components/chat/StepIndicator.tsx — the fixed step ladder (WS-E), as a row of
// compact gold pips in the bubble head with the current step named.
//
// Renders MEMO → TERMS → WORLD → SIGN → ARMED with completed steps filled and the
// current one lit. Purely presentational — the order is fixed (the machine never
// reorders), so this just reflects ctx.state.

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
  const steps = STEP_ORDER.filter((s) => s !== "IDLE");

  return (
    <div className="steps" aria-label={`Setup step: ${STEP_LABEL[active]}`}>
      {steps.map((step) => {
        const idx = STEP_ORDER.indexOf(step);
        const done = idx < activeIdx;
        const current = idx === activeIdx;
        return (
          <span
            key={step}
            className={["step", done ? "step--done" : "", current ? "step--current" : ""].join(" ")}
            aria-current={current ? "step" : undefined}
            title={STEP_LABEL[step]}
          />
        );
      })}
      <span className="step__label">{STEP_LABEL[active]}</span>
    </div>
  );
}
