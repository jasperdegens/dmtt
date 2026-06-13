// lib/context.ts — WS-C: the real ExecutorContext wiring.
//
// Assembles the production ExecutorContext from the sibling module singletons:
// WS-A's crypto surface, WS-B's hedera surface, and this workstream's store. The
// verification flags default OFF (Phase-3 mocks pass artifacts straight through)
// and flip ON per-flag via env (DMTT_VERIFY_ARM / _CHECKIN / _CANCEL / _SERVICE_FEE),
// the M2 / Phase-5 switch to real on-chain + World verification.
//
// makeContext(overrides) lets routes / tests substitute any surface (e.g. a pinned
// clock or a worldVerify backend) while keeping the rest of the wiring real.

import { cryptoSurface } from "./crypto.ts";
import { hedera } from "./hedera.ts";
import { store } from "./store.ts";
import { env } from "./env.ts";
import type { ExecutorContext, ExecutorFlags } from "./types.ts";

/** Read the verification flags from env. All OFF unless explicitly "true". */
export function flagsFromEnv(): ExecutorFlags {
  return {
    verifyArmTx: env("DMTT_VERIFY_ARM") === "true",
    verifyCheckinProof: env("DMTT_VERIFY_CHECKIN") === "true",
    verifyCancelTx: env("DMTT_VERIFY_CANCEL") === "true",
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
    ...overrides,
  };
}
