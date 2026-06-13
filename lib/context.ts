// lib/context.ts — WS-C: the real ExecutorContext wiring.
//
// Assembles the production ExecutorContext from the sibling module singletons:
// WS-A's crypto surface, WS-B's hedera surface, and this workstream's store. The
// verification flags default ON for Phase-5 real artifacts. Local mock/dev runs can
// explicitly disable individual checks via DMTT_VERIFY_ARM=false,
// DMTT_VERIFY_CHECKIN=false, or DMTT_VERIFY_CANCEL=false.
//
// makeContext(overrides) lets routes / tests substitute any surface (e.g. a pinned
// clock or a worldVerify backend) while keeping the rest of the wiring real.

import { cryptoSurface } from "./crypto.ts";
import { hedera } from "./hedera.ts";
import { store } from "./store.ts";
import { env } from "./env.ts";
import { verifyWorldProof } from "./world.ts";
import type { ExecutorContext, ExecutorFlags } from "./types.ts";

/** Read verification flags from env. Phase 5 defaults real verification ON; set a flag to "false" for local mocks. */
export function flagsFromEnv(): ExecutorFlags {
  return {
    verifyArmTx: env("DMTT_VERIFY_ARM") !== "false",
    verifyCheckinProof: env("DMTT_VERIFY_CHECKIN") !== "false",
    verifyCancelTx: env("DMTT_VERIFY_CANCEL") !== "false",
    chargeServiceFee: env("DMTT_SERVICE_FEE") === "true",
  };
}

/** The production ExecutorContext, with optional overrides for routes/tests. */
export function makeContext(overrides: Partial<ExecutorContext> = {}): ExecutorContext {
  return {
    store,
    hedera,
    crypto: cryptoSurface,
    flags: flagsFromEnv(),
    now: Date.now,
    worldVerify: verifyWorldProof,
    ...overrides,
  };
}
