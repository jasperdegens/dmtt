// lib/executors.ts — WS-C: the arm / checkin / cancel state machine (CONTRACTS §4, §8).
//
// Each executor is (ctx, input, artifacts) → Promise<ExecResult<T>>, dependency-
// injected through ctx (store / hedera / crypto / flags / now / worldVerify). The
// flags gate the real on-chain / World verification: OFF for Phase-3 mocks, ON at
// Phase-5 / M2. With the flags OFF the executors are pure orchestration.
//
// The negative paths are the point (CLAUDE.md "Definition of done"): a forged or
// replayed input — wrong policyHash, stale seq, wrong nullifier, wrong signal — must
// reject exactly like a forged on-chain request, and must leave the store unchanged.
//
// Invariants enforced here (CONTRACTS §1, §4):
//  • liveIdx === seq + 1 always.
//  • check-in CREATES the new schedule BEFORE deleting the old (crash window errs
//    toward release), then shreds the burned rung's capsule (N10).
//  • all read-modify-write goes through store.withLock (per-topic serialization).

import type {
  ExecutorContext,
  ArmInput,
  ArmArtifacts,
  ArmResult,
  CheckinInput,
  CheckinArtifacts,
  CheckinResult,
  CancelInput,
  CancelArtifacts,
  CancelResult,
  ExecResult,
  ExecError,
  ExecErrorCode,
  Switch,
  LadderRung,
  ArmedEvent,
  CheckinVerifiedEvent,
  ReleaseAuthorizedEvent,
  CancelledEvent,
} from "./types.ts";
import { armMemo, cancelMemo } from "./types.ts";

// ── helpers ──────────────────────────────────────────────────────────────────

function fail(code: ExecErrorCode, message: string): { ok: false; error: ExecError } {
  return { ok: false, error: { code, message } };
}

/** 32 random bytes as 64 lowercase hex chars. Uses WebCrypto directly (NOT lib/crypto
 *  — these executors are server-side and must not pull the client crypto module). */
function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += b.toString(16).padStart(2, "0");
  return out;
}

// ── arm ────────────────────────────────────────────────────────────────────────
// The topicId is created mid-flow, so the chain-of-effects (createTopic → ARMED →
// scheduleRelease) runs OUTSIDE withLock; the single persist happens inside withLock
// at the end (one create — there is no prior record to read-modify-write).
export async function arm(
  ctx: ExecutorContext,
  input: ArmInput,
  artifacts: ArmArtifacts,
): Promise<ExecResult<ArmResult>> {
  // 1. The recomputed policyHash must match what the client committed (and, when
  //    verified, what the device signed into the arm memo).
  if (ctx.crypto.policyHash(input.policy) !== input.policyHash) {
    return fail("POLICY_HASH_MISMATCH", "recomputed policyHash ≠ input.policyHash");
  }

  // 2. Mirror-verify the device-signed arm transfer (flag-gated; §7 recipe).
  if (ctx.flags.verifyArmTx) {
    const r = await ctx.hedera.verifyTransfer(artifacts.armTxId, {
      expectedMemo: armMemo(input.policyHash),
      debitAccountId: artifacts.ledgerAccountId,
    });
    if (!r.ok) {
      return fail("ARM_TX_UNVERIFIED", "mirror did not confirm the arm transfer");
    }
  }

  // 3. Create the audit topic (submitKey = agent), commit the policy + ladder hashes.
  const topicId = await ctx.hedera.createTopic();
  const rungHashes = input.ladder.map((r) => r.hash);

  const armedEvent: ArmedEvent = {
    type: "ARMED",
    policy: input.policy,
    policyHash: input.policyHash,
    rungHashes,
    storage: input.storage,
    armTxId: artifacts.armTxId,
    armTime: input.armTime,
  };
  await ctx.hedera.submitEvent(topicId, armedEvent);

  // 4. Schedule the rung-1 release at deadline_1 carrying RELEASE_AUTHORIZED{seq:0}.
  const deadline1 = input.ladder[0].deadline;
  const releaseNonce = randomHex(32);
  const releaseEvent: ReleaseAuthorizedEvent = {
    type: "RELEASE_AUTHORIZED",
    seq: 0,
    nonce: releaseNonce,
  };
  const scheduleId = await ctx.hedera.scheduleRelease(topicId, releaseEvent, deadline1);

  // 5. Persist the ACTIVE switch (liveIdx 1, seq 0, invariant liveIdx === seq + 1).
  const at = ctx.now();
  const sw: Switch = {
    topicId,
    status: "ACTIVE",
    policy: input.policy,
    policyHash: input.policyHash,
    storage: input.storage,
    armTxId: artifacts.armTxId,
    ledgerAccountId: artifacts.ledgerAccountId,
    armTime: input.armTime,
    ladder: input.ladder,
    liveIdx: 1,
    seq: 0,
    currentDeadline: deadline1,
    scheduleId,
    releaseNonce,
    createdAt: at,
    updatedAt: at,
  };

  await ctx.store.withLock(topicId, () => ({ next: sw, result: sw }));

  return { ok: true, value: { topicId, scheduleId, switch: sw } };
}

// ── checkin (postpone) ───────────────────────────────────────────────────────
// All of it runs inside withLock so guards + the create-before-delete ordering are
// serialized per topic. On ANY error the mutator returns next:current (unchanged).
export async function checkin(
  ctx: ExecutorContext,
  input: CheckinInput,
  artifacts: CheckinArtifacts,
): Promise<ExecResult<CheckinResult>> {
  return ctx.store.withLock<ExecResult<CheckinResult>>(input.topicId, async (current) => {
    // Guards (CONTRACTS §4): existence, active, fresh seq, a rung left to advance to.
    if (current === null) {
      return { next: null, result: fail("NOT_FOUND", "no such switch") };
    }
    if (current.status !== "ACTIVE") {
      return { next: current, result: fail("NOT_ACTIVE", `switch is ${current.status}`) };
    }
    if (input.seq !== current.seq) {
      return {
        next: current,
        result: fail("STALE_SEQ", `input.seq ${input.seq} ≠ current seq ${current.seq}`),
      };
    }

    const L = current.liveIdx; // 1..N — the rung currently armed to fire.
    // At liveIdx === N no postponement remains (ladder[L] would be out of range).
    if (L >= current.policy.terms.n) {
      return {
        next: current,
        result: fail("LADDER_EXHAUSTED", `liveIdx ${L} already at N=${current.policy.terms.n}`),
      };
    }

    // World-verify the proof + re-enforce the bound nullifier (flag-gated; §4).
    if (ctx.flags.verifyCheckinProof) {
      if (!ctx.worldVerify) {
        return {
          next: current,
          result: fail("INTERNAL", "verifyCheckinProof set but no worldVerify in ctx"),
        };
      }
      const res = await ctx.worldVerify({
        proof: artifacts.proof,
        action: artifacts.action,
        signal: input.signal,
      });
      if (!res.ok) {
        return { next: current, result: fail("WORLD_VERIFY_FAILED", res.detail ?? "verify rejected") };
      }
      if (artifacts.proof.nullifier_hash !== current.policy.nullifier) {
        return {
          next: current,
          result: fail("WRONG_NULLIFIER", "proof nullifier ≠ enrolled policy.nullifier"),
        };
      }
    }

    // The next (now-live) rung is ladder[L] (0-indexed L = rung idx L+1).
    const newSeq = L; // seq advances to L; invariant newLiveIdx = L+1 = newSeq+1.
    const newDeadline = current.ladder[L].deadline;
    const nextRungHash = current.ladder[L].hash;

    // Re-enforce the signal binding (signal = signalHash(nextRungHash, newDeadline, topicId, newSeq)).
    const expectedSignal = ctx.crypto.signalHash(
      nextRungHash,
      newDeadline,
      current.topicId,
      newSeq,
    );
    if (expectedSignal !== input.signal) {
      return { next: current, result: fail("WRONG_SIGNAL", "recomputed signal ≠ submitted signal") };
    }

    // SUCCESS — create the NEW schedule BEFORE deleting the OLD (crash window errs
    // toward release: a leftover schedule fires; a missing one cannot).
    const newNonce = randomHex(32);
    const newReleaseEvent: ReleaseAuthorizedEvent = {
      type: "RELEASE_AUTHORIZED",
      seq: newSeq,
      nonce: newNonce,
    };
    const newScheduleId = await ctx.hedera.scheduleRelease(
      current.topicId,
      newReleaseEvent,
      newDeadline,
    );
    if (current.scheduleId) {
      await ctx.hedera.deleteSchedule(current.scheduleId);
    }

    // Burn rung L (shred its capsule from the store — N10). Rung L is ladder[L-1].
    const ladder: LadderRung[] = current.ladder.map((r, i) =>
      i === L - 1 ? { ...r, capsuleB64: "" } : r,
    );

    const updated: Switch = {
      ...current,
      ladder,
      liveIdx: L + 1,
      seq: newSeq,
      currentDeadline: newDeadline,
      scheduleId: newScheduleId,
      releaseNonce: newNonce,
      updatedAt: ctx.now(),
    };

    const checkinEvent: CheckinVerifiedEvent = {
      type: "CHECKIN_VERIFIED",
      proof: artifacts.proof,
      seq: newSeq,
      newDeadline,
      nextRungHash,
      signal: input.signal,
    };
    await ctx.hedera.submitEvent(current.topicId, checkinEvent);

    return {
      next: updated,
      result: {
        ok: true,
        value: { seq: newSeq, liveIdx: L + 1, newDeadline, scheduleId: newScheduleId },
      },
    };
  });
}

// ── cancel ─────────────────────────────────────────────────────────────────────
export async function cancel(
  ctx: ExecutorContext,
  input: CancelInput,
  artifacts: CancelArtifacts,
): Promise<ExecResult<CancelResult>> {
  return ctx.store.withLock<ExecResult<CancelResult>>(input.topicId, async (current) => {
    if (current === null) {
      return { next: null, result: fail("NOT_FOUND", "no such switch") };
    }
    if (current.status !== "ACTIVE") {
      return { next: current, result: fail("NOT_ACTIVE", `switch is ${current.status}`) };
    }

    // Mirror-verify the device-signed cancel transfer (flag-gated; §7 recipe).
    if (ctx.flags.verifyCancelTx) {
      const r = await ctx.hedera.verifyTransfer(artifacts.cancelTxId, {
        expectedMemo: cancelMemo(current.topicId),
        debitAccountId: artifacts.ledgerAccountId,
      });
      if (!r.ok) {
        return { next: current, result: fail("CANCEL_TX_UNVERIFIED", "mirror did not confirm the cancel transfer") };
      }
    }

    // Tear down the live schedule, then shred the WHOLE ladder (N10).
    if (current.scheduleId) {
      await ctx.hedera.deleteSchedule(current.scheduleId);
    }
    const ladder: LadderRung[] = current.ladder.map((r) => ({ ...r, capsuleB64: "" }));

    const cancelledEvent: CancelledEvent = {
      type: "CANCELLED",
      cancelTxId: artifacts.cancelTxId,
    };
    await ctx.hedera.submitEvent(current.topicId, cancelledEvent);

    const at = ctx.now();
    const updated: Switch = {
      ...current,
      ladder,
      status: "CANCELLED",
      scheduleId: null,
      cancelled: { cancelTxId: artifacts.cancelTxId, at },
      updatedAt: at,
    };

    return {
      next: updated,
      result: { ok: true, value: { topicId: current.topicId, cancelTxId: artifacts.cancelTxId } },
    };
  });
}
