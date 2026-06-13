// lib/fixtures.ts — one mock fixture per frozen contract (Phase 2 verify criterion).
//
// Purpose:
//  1. tsc proves every contract in lib/types.ts is instantiable and internally consistent.
//  2. The hash fixtures are REAL cross-check vectors: WS-A (lib/crypto.ts) must reproduce
//     POLICY_HASH_VECTOR and SIGNAL_VECTOR exactly from the documented canonical encoding
//     (docs/CONTRACTS.md §"Hashing"). The canonical inputs are pinned alongside each.
//
// Everything here is annotated with `satisfies <ContractType>` so a shape drift in
// types.ts breaks the build.

import {
  armMemo,
  cancelMemo,
  parseArmMemo,
  parseCancelMemo,
  MEMO_ARM_PREFIX,
  MEMO_CANCEL_PREFIX,
  LADDER_N,
  FAST_PATH_MAX_BYTES,
  ENV_VARS,
  SERVER_ONLY_SECRETS,
  type Terms,
  type Policy,
  type LadderRung,
  type HfsStorageRef,
  type HcsStorageRef,
  type StorageRef,
  type Switch,
  type ReleaseRecord,
  type CancelRecord,
  type ArmedEvent,
  type CheckinVerifiedEvent,
  type ReleaseAuthorizedEvent,
  type CapsulePublishedEvent,
  type BulletinEvent,
  type CancelledEvent,
  type ServiceFeePaidEvent,
  type SwitchEvent,
  type WorldProof,
  type RpContextRequest,
  type RpContextResponse,
  type WorldVerifyRequest,
  type WorldVerifyResponse,
  type SwitchView,
  type FileProxyMeta,
  type StoreMutation,
  type StoreMutator,
  type SwitchStore,
  type MirrorVerifyResult,
  type MirrorTopicMessage,
  type MirrorTransaction,
  type HederaSurface,
  type CryptoSurface,
  type ExecutorFlags,
  type ExecutorContext,
  type ExecError,
  type ExecResult,
  type ArmInput,
  type ArmArtifacts,
  type ArmResult,
  type CheckinInput,
  type CheckinArtifacts,
  type CheckinResult,
  type CancelInput,
  type CancelArtifacts,
  type CancelResult,
  type ArmExecutor,
  type CheckinExecutor,
  type CancelExecutor,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Pinned scenario (one armed switch, one check-in performed).
// ─────────────────────────────────────────────────────────────────────────────

const TOPIC_ID = "0.0.7777777";
const LEDGER_ACCOUNT = "0.0.1234567";
const AGENT_FILE = "0.0.8888888";
const ARM_TIME = 1_760_000_000_000; // pinned unix ms
const INTERVAL_SEC = 86_400; // 1 day
const INTERVAL_MS = INTERVAL_SEC * 1000;
const ARM_TX_ID = "0.0.1234567-1760000000-000000000";
const CANCEL_TX_ID = "0.0.1234567-1760200000-000000000";

// Cross-check vectors (computed from the canonical encoding in docs/CONTRACTS.md).
export const CIPHERTEXT_HASH_VECTOR =
  "5430f9936b4151ab899ee7af3ae2f723319484953442d861ecea8cb6fdbbc86a";
export const NONCE_VECTOR =
  "9f1c7a4b2e8d05f36a91c4be7d20a8f15c3e6b9d042a7f18e5c90b3d6172a4e8b";
export const NULLIFIER_VECTOR = "12345678901234567890123456789012345678901234567890";
/** sha256(canonicalJSON(policyFixture)). WS-A must reproduce this. */
export const POLICY_HASH_VECTOR =
  "5e69cb3137841c36cc5a6aafcea18e8d81f5dbe654eca0f4e64f652539ba5285";
/** sha256(canonicalJSON({nextRungHash:rung2, newDeadline, topicId, seq:1})) after one check-in. */
export const SIGNAL_VECTOR =
  "4811168a447626334db554e71bce35e04f2905b5ac6bb17a36098f808d953ced";

// ─────────────────────────────────────────────────────────────────────────────
// Core domain.
// ─────────────────────────────────────────────────────────────────────────────

export const termsFixture = {
  intervalSec: INTERVAL_SEC,
  n: LADDER_N,
  fundingHbar: 50,
  bulletin: "If you are reading this, I have gone quiet. — A.",
} satisfies Terms;

export const policyFixture = {
  terms: termsFixture,
  nullifier: NULLIFIER_VECTOR,
  ciphertextHash: CIPHERTEXT_HASH_VECTOR,
  nonce: NONCE_VECTOR,
} satisfies Policy;

// Illustrative 2-rung ladder (real ladders are N = LADDER_N rungs). `round` is the
// authoritative value WS-A computes via roundAt(deadline); the values here are
// quicknet-plausible illustrations only. `hash` === sha256(utf8(capsuleB64)).
const RUNG_1_CAPSULE =
  "-----BEGIN AGE ENCRYPTED FILE-----\nFIXTURE_RUNG_1_ARMORED_TLOCK_CAPSULE_PLACEHOLDER\n-----END AGE ENCRYPTED FILE-----\n";
const RUNG_2_CAPSULE =
  "-----BEGIN AGE ENCRYPTED FILE-----\nFIXTURE_RUNG_2_ARMORED_TLOCK_CAPSULE_PLACEHOLDER\n-----END AGE ENCRYPTED FILE-----\n";

export const ladderFixture = [
  {
    idx: 1,
    round: 22_427_678,
    deadline: ARM_TIME + 1 * INTERVAL_MS, // 1760086400000
    hash: "914b605cd26d27304a9b26fb4b2bd48d5c5d6fe2e2080103e6c819d909179e60",
    capsuleB64: RUNG_1_CAPSULE,
  },
  {
    idx: 2,
    round: 22_456_478,
    deadline: ARM_TIME + 2 * INTERVAL_MS, // 1760172800000
    hash: "8ca209f0857875aa51bd81bfec6afd2a4ab7a4d0f2d3aa1e2b8480f59ca04400",
    capsuleB64: RUNG_2_CAPSULE,
  },
] satisfies LadderRung[];

const RUNG_HASHES = ladderFixture.map((r) => r.hash);

export const hfsStorageFixture = {
  kind: "hfs",
  fileId: AGENT_FILE,
  bytes: 1024,
} satisfies HfsStorageRef;

export const hcsStorageFixture = {
  kind: "hcs",
  topicId: "0.0.9999999",
  chunks: 40,
  bytes: 786_432, // 768 KB — large path
} satisfies HcsStorageRef;

export const storageFixture: StorageRef = hfsStorageFixture;

export const releaseRecordFixture = {
  seq: 1,
  idx: 2,
  at: ARM_TIME + 2 * INTERVAL_MS + 34, // ~34 ms firing lag (S2)
  capsulePublished: true,
} satisfies ReleaseRecord;

export const cancelRecordFixture = {
  cancelTxId: CANCEL_TX_ID,
  at: ARM_TIME + 90_000,
} satisfies CancelRecord;

// An ACTIVE switch after exactly one check-in: liveIdx 2, seq 1 (invariant liveIdx === seq+1).
export const activeSwitchFixture = {
  topicId: TOPIC_ID,
  status: "ACTIVE",
  policy: policyFixture,
  policyHash: POLICY_HASH_VECTOR,
  storage: storageFixture,
  armTxId: ARM_TX_ID,
  ledgerAccountId: LEDGER_ACCOUNT,
  armTime: ARM_TIME,
  ladder: ladderFixture,
  liveIdx: 2,
  seq: 1,
  currentDeadline: ARM_TIME + 2 * INTERVAL_MS,
  scheduleId: "0.0.5555555",
  releaseNonce: "1f2e3d4c5b6a7988796a5b4c3d2e1f00112233445566778899aabbccddeeff00",
  createdAt: ARM_TIME,
  updatedAt: ARM_TIME + INTERVAL_MS,
} satisfies Switch;

export const releasedSwitchFixture = {
  ...activeSwitchFixture,
  status: "RELEASED",
  scheduleId: null,
  released: releaseRecordFixture,
  updatedAt: releaseRecordFixture.at,
} satisfies Switch;

export const cancelledSwitchFixture = {
  ...activeSwitchFixture,
  status: "CANCELLED",
  scheduleId: null,
  cancelled: cancelRecordFixture,
  updatedAt: cancelRecordFixture.at,
} satisfies Switch;

// ─────────────────────────────────────────────────────────────────────────────
// Topic events — one of every variant, in lifecycle order.
// ─────────────────────────────────────────────────────────────────────────────

export const armedEventFixture = {
  type: "ARMED",
  policy: policyFixture,
  policyHash: POLICY_HASH_VECTOR,
  rungHashes: RUNG_HASHES,
  storage: storageFixture,
  armTxId: ARM_TX_ID,
  armTime: ARM_TIME,
} satisfies ArmedEvent;

export const checkinVerifiedEventFixture = {
  type: "CHECKIN_VERIFIED",
  proof: worldProofFixture(),
  seq: 1,
  newDeadline: ARM_TIME + 2 * INTERVAL_MS,
  nextRungHash: ladderFixture[1].hash, // rung 2 — the now-live rung
  signal: SIGNAL_VECTOR,
} satisfies CheckinVerifiedEvent;

export const releaseAuthorizedEventFixture = {
  type: "RELEASE_AUTHORIZED",
  seq: 1,
  nonce: activeSwitchFixture.releaseNonce,
} satisfies ReleaseAuthorizedEvent;

export const capsulePublishedEventFixture = {
  type: "CAPSULE_PUBLISHED",
  idx: 2,
  seq: 1,
  capsuleB64: RUNG_2_CAPSULE,
} satisfies CapsulePublishedEvent;

export const bulletinEventFixture = {
  type: "BULLETIN",
  seq: 1,
  text: "A. has gone silent. The enclosed memo is now public per their standing instructions.",
} satisfies BulletinEvent;

export const cancelledEventFixture = {
  type: "CANCELLED",
  cancelTxId: CANCEL_TX_ID,
} satisfies CancelledEvent;

export const serviceFeePaidEventFixture = {
  type: "SERVICE_FEE_PAID",
  seq: 1,
  amountHbar: 0.5,
  txId: "0.0.9000000-1760086400-000000000",
} satisfies ServiceFeePaidEvent;

/** The full audit trail of a switch that armed, was checked in once, then released. */
export const eventTrailFixture = [
  armedEventFixture,
  checkinVerifiedEventFixture,
  releaseAuthorizedEventFixture,
  capsulePublishedEventFixture,
  bulletinEventFixture,
] satisfies SwitchEvent[];

// ─────────────────────────────────────────────────────────────────────────────
// World ID.
// ─────────────────────────────────────────────────────────────────────────────

function worldProofFixture(): WorldProof {
  return {
    proof: "0x" + "ab".repeat(256),
    merkle_root: "0x" + "cd".repeat(32),
    nullifier_hash: NULLIFIER_VECTOR,
    verification_level: "orb",
  } satisfies WorldProof;
}
export const worldProof = worldProofFixture();

export const rpContextRequestFixture = {
  signal: SIGNAL_VECTOR,
} satisfies RpContextRequest;

export const rpContextResponseFixture = {
  rp_id: "rp_dmtt_staging",
  nonce: "b2c3d4e5f6a1",
  created_at: "2026-06-13T03:00:00.000Z",
  expires_at: "2026-06-13T03:10:00.000Z",
  signature: "0x" + "ef".repeat(32),
} satisfies RpContextResponse;

export const worldVerifyRequestFixture = {
  proof: worldProof,
  action: "check-in",
  signal: SIGNAL_VECTOR,
} satisfies WorldVerifyRequest;

export const worldVerifyResponseFixture = {
  ok: true,
  nullifier: NULLIFIER_VECTOR,
} satisfies WorldVerifyResponse;

// ─────────────────────────────────────────────────────────────────────────────
// REST projections.
// ─────────────────────────────────────────────────────────────────────────────

export const switchViewFixture = {
  topicId: TOPIC_ID,
  status: "ACTIVE",
  policyHash: POLICY_HASH_VECTOR,
  terms: termsFixture,
  storage: storageFixture,
  armTime: ARM_TIME,
  liveIdx: 2,
  seq: 1,
  currentDeadline: ARM_TIME + 2 * INTERVAL_MS,
  rungHashes: RUNG_HASHES,
  events: [armedEventFixture, checkinVerifiedEventFixture],
} satisfies SwitchView;

export const fileProxyMetaFixture = {
  fileId: AGENT_FILE,
  bytes: 1024,
  contentType: "application/octet-stream",
} satisfies FileProxyMeta;

// ─────────────────────────────────────────────────────────────────────────────
// Store — a StoreMutation + a minimal in-memory mock implementing SwitchStore.
// ─────────────────────────────────────────────────────────────────────────────

export const storeMutationFixture = {
  next: activeSwitchFixture,
  result: { seq: 1 },
} satisfies StoreMutation<{ seq: number }>;

export const mockStore: SwitchStore = (() => {
  const mem = new Map<string, Switch>([[TOPIC_ID, activeSwitchFixture]]);
  const store: SwitchStore = {
    async load(topicId) {
      return mem.get(topicId) ?? null;
    },
    async save(sw) {
      mem.set(sw.topicId, sw);
    },
    async list() {
      return [...mem.keys()];
    },
    async withLock<T>(topicId: string, mutator: StoreMutator<T>): Promise<T> {
      const current = mem.get(topicId) ?? null;
      const { next, result } = await mutator(current);
      if (next) mem.set(topicId, next);
      else mem.delete(topicId);
      return result;
    },
  };
  return store;
})();

// ─────────────────────────────────────────────────────────────────────────────
// Mirror + dependency surfaces (WS-A / WS-B), as minimal mocks.
// ─────────────────────────────────────────────────────────────────────────────

export const mirrorVerifyResultFixture = {
  ok: true,
  result: "SUCCESS",
  memo: armMemo(POLICY_HASH_VECTOR),
  checks: { success: true, memoMatch: true, debit: true },
  transactionId: ARM_TX_ID,
  consensusTimestamp: "1760000000.000000001",
} satisfies MirrorVerifyResult;

export const mirrorTopicMessageFixture = {
  sequenceNumber: 1,
  consensusTimestamp: "1760000000.000000002",
  contents: Buffer.from(JSON.stringify(armedEventFixture), "utf8").toString("base64"),
} satisfies MirrorTopicMessage;

export const mirrorTransactionFixture = {
  transactionId: ARM_TX_ID,
  result: "SUCCESS",
  memoBase64: Buffer.from(armMemo(POLICY_HASH_VECTOR), "utf8").toString("base64"),
  consensusTimestamp: "1760000000.000000001",
  transfers: [
    { account: LEDGER_ACCOUNT, amount: -5_000_000_000 },
    { account: "0.0.2000000", amount: 5_000_000_000 },
  ],
} satisfies MirrorTransaction;

export const mockHedera: HederaSurface = {
  async storeCiphertext(bytes) {
    return bytes.length <= FAST_PATH_MAX_BYTES ? hfsStorageFixture : hcsStorageFixture;
  },
  async readCiphertext(_ref) {
    return new Uint8Array([1, 2, 3]);
  },
  async createTopic() {
    return TOPIC_ID;
  },
  async submitEvent(_topicId, _event) {
    return { seq: 1, txId: ARM_TX_ID };
  },
  async scheduleRelease(_topicId, _event, _deadline) {
    return "0.0.5555555";
  },
  async deleteSchedule(_scheduleId) {
    /* mock */
  },
  async verifyTransfer(_txId, _opts) {
    return mirrorVerifyResultFixture;
  },
  async listTopicMessages(_topicId, _afterSeq) {
    return [mirrorTopicMessageFixture];
  },
};

export const mockCrypto: CryptoSurface = {
  async encrypt(_plaintext) {
    return { ciphertext: new Uint8Array([9, 9, 9]), key: new Uint8Array(32) };
  },
  async decrypt(_ciphertext, _key) {
    return new Uint8Array([1]);
  },
  hashCiphertext(_ciphertext) {
    return CIPHERTEXT_HASH_VECTOR;
  },
  async mintLadder(_key, _armTime, _terms) {
    return ladderFixture;
  },
  async openCapsule(_capsuleB64) {
    return new Uint8Array(32);
  },
  policyHash(_policy) {
    return POLICY_HASH_VECTOR;
  },
  signalHash(_nextRungHash, _newDeadline, _topicId, _seq) {
    return SIGNAL_VECTOR;
  },
  capsuleHash(_capsuleB64) {
    return RUNG_HASHES[0];
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Executors — flags, context, inputs/artifacts/results, and stub implementations.
// ─────────────────────────────────────────────────────────────────────────────

export const phase3FlagsFixture = {
  verifyArmTx: false, // mocks pass artifacts straight through in Phase 3
  verifyCheckinProof: false,
  verifyCancelTx: false,
  chargeServiceFee: false,
} satisfies ExecutorFlags;

export const phase5FlagsFixture = {
  verifyArmTx: true, // real artifacts at M2
  verifyCheckinProof: true,
  verifyCancelTx: true,
  chargeServiceFee: true,
} satisfies ExecutorFlags;

export const executorContextFixture = {
  store: mockStore,
  hedera: mockHedera,
  crypto: mockCrypto,
  flags: phase3FlagsFixture,
  now: () => ARM_TIME + INTERVAL_MS,
  async worldVerify(_req) {
    return worldVerifyResponseFixture;
  },
} satisfies ExecutorContext;

export const armInputFixture = {
  policy: policyFixture,
  policyHash: POLICY_HASH_VECTOR,
  storage: storageFixture,
  ladder: ladderFixture,
  armTime: ARM_TIME,
} satisfies ArmInput;

export const armArtifactsFixture = {
  armTxId: ARM_TX_ID,
  ledgerAccountId: LEDGER_ACCOUNT,
  fundingHbar: 50,
} satisfies ArmArtifacts;

export const armResultFixture = {
  topicId: TOPIC_ID,
  scheduleId: "0.0.5555555",
  switch: activeSwitchFixture,
} satisfies ArmResult;

export const checkinInputFixture = {
  topicId: TOPIC_ID,
  seq: 0, // client believed seq 0; executor advances to 1
  signal: SIGNAL_VECTOR,
} satisfies CheckinInput;

export const checkinArtifactsFixture = {
  proof: worldProof,
  action: "check-in",
} satisfies CheckinArtifacts;

export const checkinResultFixture = {
  seq: 1,
  liveIdx: 2,
  newDeadline: ARM_TIME + 2 * INTERVAL_MS,
  scheduleId: "0.0.5555556",
} satisfies CheckinResult;

export const cancelInputFixture = {
  topicId: TOPIC_ID,
} satisfies CancelInput;

export const cancelArtifactsFixture = {
  cancelTxId: CANCEL_TX_ID,
  ledgerAccountId: LEDGER_ACCOUNT,
} satisfies CancelArtifacts;

export const cancelResultFixture = {
  topicId: TOPIC_ID,
  cancelTxId: CANCEL_TX_ID,
} satisfies CancelResult;

// ExecResult — both arms of the union.
export const execOkFixture = {
  ok: true,
  value: checkinResultFixture,
} satisfies ExecResult<CheckinResult>;

export const execErrorFixture = {
  code: "STALE_SEQ",
  message: "input.seq 0 ≠ current seq 1",
} satisfies ExecError;

export const execErrFixture = {
  ok: false,
  error: execErrorFixture,
} satisfies ExecResult<CheckinResult>;

// Stub executors — prove the function contracts are implementable end-to-end.
export const mockArm: ArmExecutor = async (_ctx, _input, _artifacts) => ({
  ok: true,
  value: armResultFixture,
});

export const mockCheckin: CheckinExecutor = async (_ctx, _input, _artifacts) => ({
  ok: true,
  value: checkinResultFixture,
});

export const mockCancel: CancelExecutor = async (_ctx, _input, _artifacts) => ({
  ok: true,
  value: cancelResultFixture,
});

// ─────────────────────────────────────────────────────────────────────────────
// Memo grammar — exercise builders + parsers (round-trip + reject malformed).
// ─────────────────────────────────────────────────────────────────────────────

export const memoFixtures = {
  arm: armMemo(POLICY_HASH_VECTOR), // "DMTT:ARM:5e69cb…"
  cancel: cancelMemo(TOPIC_ID), //     "DMTT:CANCEL:0.0.7777777"
  armParsed: parseArmMemo(armMemo(POLICY_HASH_VECTOR)), // === POLICY_HASH_VECTOR
  cancelParsed: parseCancelMemo(cancelMemo(TOPIC_ID)), // === TOPIC_ID
  armRejectsCancel: parseArmMemo(cancelMemo(TOPIC_ID)), // === null
  cancelRejectsArm: parseCancelMemo(armMemo(POLICY_HASH_VECTOR)), // === null
  prefixes: { arm: MEMO_ARM_PREFIX, cancel: MEMO_CANCEL_PREFIX },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Env names.
// ─────────────────────────────────────────────────────────────────────────────

export const envFixtures = {
  all: ENV_VARS,
  serverOnly: SERVER_ONLY_SECRETS,
} as const;
