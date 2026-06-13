// lib/types.ts — DMTT frozen contract surface (Phase 2).
//
// This is the ONE interface every workstream shares. After the Phase 2 freeze,
// workstreams run independently against mocks of these types; changing anything
// here requires a human decision (CLAUDE.md "Definition of done"). The prose
// spec — lifecycle, hashing algorithms, freeze decisions, mirror-verify recipe —
// lives in docs/CONTRACTS.md. Keep the two in lockstep.
//
// Design anchors (do not re-litigate — see CLAUDE.md / docs/EVALUATION.md):
//  C1  arm & cancel are device-signed CryptoTransfers, authorized by mirror-read
//  C2  ciphertext storage: HFS ≤4 KB fast path | HCS large path (freeze decision below)
//  N10 rungs (tlock capsules) stay PRIVATE, agent-held, until release is authorized
//
// Keep this file dependency-free (primitive aliases, no SDK imports) so it
// type-checks standalone and is importable from both client and server.

// ─────────────────────────────────────────────────────────────────────────────
// Primitive aliases — documentary, all strings/numbers at runtime.
// ─────────────────────────────────────────────────────────────────────────────

/** Hedera entity id, "shard.realm.num" e.g. "0.0.1234". */
export type AccountId = string;
export type TopicId = string;
export type FileId = string;
export type ScheduleId = string;
/** Hedera transaction id, "{payer}-{validStartSecs}-{nanos}" e.g. "0.0.12-1700000000-000000000". */
export type TxId = string;

/** Lowercase hex, no "0x" prefix. */
export type Hex = string;
/** 32-byte digest as 64 lowercase hex chars (sha-256 outputs, nonces). */
export type Hex64 = string;
/** Standard base64 (capsules, ciphertext chunks). */
export type Base64 = string;
/** Unix epoch milliseconds. */
export type UnixMs = number;
/** World ID nullifier_hash, a uint256 rendered as a DECIMAL string. */
export type Nullifier = string;

// ─────────────────────────────────────────────────────────────────────────────
// Constants / defaults.
// ─────────────────────────────────────────────────────────────────────────────

/** Default ladder length N (rungs 1..N). 20 rungs of runway before forced release. */
export const LADDER_N = 20;
/** ≤ this many ciphertext bytes ⇒ HFS single immutable FileCreate (fast path).
 *  Larger ⇒ HCS chunked storage (≈100× cheaper than HFS append; see freeze decision). */
export const FAST_PATH_MAX_BYTES = 4096;
/** drand quicknet beacon period (seconds). tlock rounds are spaced by this. */
export const DRAND_PERIOD_SEC = 3;
/** Hedera transaction-memo cap (UTF-8 bytes). Our arm/cancel memos fit (73 / ~21). */
export const MEMO_MAX_BYTES = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Core domain — Terms / Policy / LadderRung / StorageRef / Switch.
// ─────────────────────────────────────────────────────────────────────────────

/** The release terms the user chooses in the chat (TERMS step). Bound into policyHash. */
export interface Terms {
  /** Postpone cadence (seconds). Rung i targets armTime + i·intervalSec. */
  intervalSec: number;
  /** Ladder length N (rungs 1..N). Defaults to LADDER_N. */
  n: number;
  /** FUNDING moved Ledger → agent at arm (ops budget + release bounty), in ℏ. */
  fundingHbar: number;
  /** Public message the watcher posts at release (seeds BULLETIN.text). May be empty. */
  bulletin: string;
}

/** Everything the arm memo commits to. policyHash = sha256(canonicalJSON(policy)). */
export interface Policy {
  terms: Terms;
  /** World human enrolled at arm (uint256 decimal). One of the four authorities. */
  nullifier: Nullifier;
  /** sha-256 of the stored ciphertext bytes (hex). Binds policy ↔ ciphertext. */
  ciphertextHash: Hex64;
  /** 32 random bytes (hex). Salts the commitment so policyHash is unguessable. */
  nonce: Hex64;
}

/** One rung of the tlock ladder. The capsule is AGENT-HELD and private until its
 *  rung fires (N10); only `hash` is ever published (in ARMED.rungHashes[]). */
export interface LadderRung {
  /** 1..N. */
  idx: number;
  /** drand quicknet round this rung is sealed to = roundAt(deadline). */
  round: number;
  /** Wall-clock target = armTime + idx·intervalSec·1000. */
  deadline: UnixMs;
  /** sha-256(utf8(capsuleB64)) (hex). Committed publicly; the capsule is not. */
  hash: Hex64;
  /** Armored tlock capsule (~601 B). PRIVATE — never in any public artifact pre-release. */
  capsuleB64: Base64;
}

/** Where a switch's ciphertext lives. Discriminated by `kind` (Phase 2 freeze decision). */
export type StorageRef = HfsStorageRef | HcsStorageRef;

/** ≤4 KB fast path: a single immutable FileCreate (empty KeyList). Read via the
 *  backend FileContentsQuery proxy at GET /api/file/[fileId] (mirror serves no file bytes). */
export interface HfsStorageRef {
  kind: "hfs";
  fileId: FileId;
  bytes: number;
}

/** Large path: ciphertext chunked across a DEDICATED storage topic (separate from the
 *  switch's audit topic). Reveal reassembles the chunks from the mirror in sequence
 *  order — no FileContentsQuery proxy needed. ≈100× cheaper than the HFS append path. */
export interface HcsStorageRef {
  kind: "hcs";
  topicId: TopicId;
  /** Number of ordered messages holding the ciphertext. */
  chunks: number;
  bytes: number;
}

export type SwitchStatus = "ACTIVE" | "RELEASED" | "CANCELLED";

/** The full persisted switch record: data/switches/{topicId}.json (gitignored — it
 *  holds the agent-held ladder capsules). Public callers get SwitchView, never this. */
export interface Switch {
  /** The switch's HCS audit topic id — also its identity. */
  topicId: TopicId;
  status: SwitchStatus;

  policy: Policy;
  /** Hex64 — bound in the ARM memo; recomputed from policy and checked on every read. */
  policyHash: Hex64;
  storage: StorageRef;

  /** Device-signed ARM CryptoTransfer (Ledger → agent), mirror-verified. */
  armTxId: TxId;
  /** The user's Hedera account — the debited signer in the arm/cancel transfers. */
  ledgerAccountId: AccountId;
  /** Ladder anchor (the arm moment). All rung deadlines derive from this. */
  armTime: UnixMs;

  /** N rungs. Capsules are agent-held & private (N10); burned rungs are shredded. */
  ladder: LadderRung[];
  /** 1..N — the soonest un-burned rung, currently armed to fire. */
  liveIdx: number;
  /** Monotonic check-in/release counter. INVARIANT: liveIdx === seq + 1. */
  seq: number;
  /** ladder[liveIdx-1].deadline — when the live schedule fires. */
  currentDeadline: UnixMs;
  /** Active ScheduleCreate id; null after release or cancel. */
  scheduleId: ScheduleId | null;
  /** Nonce carried by the live RELEASE_AUTHORIZED (watcher idempotency key). */
  releaseNonce: Hex64;

  /** Set once the schedule fires and release is authorized. */
  released?: ReleaseRecord;
  /** Set once a device-signed cancel is honored. */
  cancelled?: CancelRecord;

  createdAt: UnixMs;
  updatedAt: UnixMs;
}

export interface ReleaseRecord {
  /** The seq the RELEASE_AUTHORIZED carried (= idx - 1). */
  seq: number;
  /** The fired rung (= seq + 1). Its capsule becomes public via CAPSULE_PUBLISHED. */
  idx: number;
  at: UnixMs;
  /** Watcher posted CAPSULE_PUBLISHED for `idx`. */
  capsulePublished: boolean;
}

export interface CancelRecord {
  /** Device-signed CANCEL CryptoTransfer, mirror-verified. */
  cancelTxId: TxId;
  at: UnixMs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Topic event schema — the audit trail / state store on the switch's HCS topic.
// Each event is one topic message: utf8(JSON.stringify(event)). Discriminated by `type`.
// ─────────────────────────────────────────────────────────────────────────────

export type SwitchEventType = SwitchEvent["type"];

/** ARMED{policy, rungHashes[]} — posted once at arm. Commits the policy and the full
 *  ladder hash list (externally verifiable signal binding + recovery claim). */
export interface ArmedEvent {
  type: "ARMED";
  policy: Policy;
  policyHash: Hex64;
  /** N capsule hashes, rung order. rungHashes[i] === sha256(utf8(ladder[i].capsuleB64)). */
  rungHashes: Hex64[];
  storage: StorageRef;
  armTxId: TxId;
  armTime: UnixMs;
}

/** CHECKIN_VERIFIED{proof, seq, newDeadline} — posted on each verified postponement. */
export interface CheckinVerifiedEvent {
  type: "CHECKIN_VERIFIED";
  /** The World proof, forwarded AS-IS to /api/v4/verify/{rp_id}. */
  proof: WorldProof;
  /** The NEW seq after advancing (was seq, now seq+1). */
  seq: number;
  /** ladder[liveIdx-1].deadline after advancing one rung. */
  newDeadline: UnixMs;
  /** The now-live rung's hash (=== ARMED.rungHashes[liveIdx-1]). */
  nextRungHash: Hex64;
  /** signalHash(nextRungHash, newDeadline, topicId, seq) — re-enforced backend-side. */
  signal: Hex64;
}

/** RELEASE_AUTHORIZED{seq, nonce} — the ONLY thing the schedule carries. ≤1 KB
 *  (scheduled messages can't chunk). Minimal by design (N10): no capsule here. */
export interface ReleaseAuthorizedEvent {
  type: "RELEASE_AUTHORIZED";
  seq: number;
  /** Idempotency key — the watcher tolerates duplicate RELEASE_AUTHORIZED. */
  nonce: Hex64;
}

/** CAPSULE_PUBLISHED{capsuleB64} — the watcher's reaction to RELEASE_AUTHORIZED. The
 *  fired rung's capsule, now decryptable (its drand round has passed). */
export interface CapsulePublishedEvent {
  type: "CAPSULE_PUBLISHED";
  /** The fired rung (= seq + 1); matches ARMED.rungHashes[idx-1]. */
  idx: number;
  seq: number;
  capsuleB64: Base64;
}

/** BULLETIN{text} — LLM-composed public message, posted at release. */
export interface BulletinEvent {
  type: "BULLETIN";
  seq: number;
  text: string;
}

/** CANCELLED{cancelTxId} — posted when a device-signed cancel is honored. */
export interface CancelledEvent {
  type: "CANCELLED";
  cancelTxId: TxId;
}

/** SERVICE_FEE_PAID — optional per-check-in fee the agent pays itself for a recurring
 *  "agentic payment" story. Off unless ExecutorFlags.chargeServiceFee. */
export interface ServiceFeePaidEvent {
  type: "SERVICE_FEE_PAID";
  seq: number;
  amountHbar: number;
  txId: TxId;
}

export type SwitchEvent =
  | ArmedEvent
  | CheckinVerifiedEvent
  | ReleaseAuthorizedEvent
  | CapsulePublishedEvent
  | BulletinEvent
  | CancelledEvent
  | ServiceFeePaidEvent;

// ─────────────────────────────────────────────────────────────────────────────
// World ID 4.0 — proof + rp_context + verify shapes.
// ─────────────────────────────────────────────────────────────────────────────

/** IDKit success result, forwarded to verify unchanged (no re-encoding). */
export interface WorldProof {
  proof: string;
  merkle_root: string;
  /** Equals policy.nullifier (the stored identifier). uint256 decimal. */
  nullifier_hash: Nullifier;
  /** Credential strength, e.g. "orb". */
  verification_level: string;
}

export interface WorldIdkitResponse {
  protocol_version?: string;
  nonce?: string;
  action?: string;
  environment?: WorldEnvironment;
  responses: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

/** POST /api/world/rp-context request — the signal to bind into the proof request. */
export interface RpContextRequest {
  signal: Hex64;
}

/** Backend-signed rp_context (signRequest from @worldcoin/idkit-core/signing).
 *  The signing_key is a server-only secret — never NEXT_PUBLIC_*. */
export interface RpContextResponse {
  rp_id: string;
  nonce: string;
  created_at: string;
  expires_at: string;
  signature: string;
}

/** POST /api/world/verify request. Real IDKit v4 flows forward the full
 *  `idkitResponse` AS-IS because Developer Portal verify requires `responses[]`.
 *  `proof` remains for executor fixtures and legacy compact artifacts. */
export interface WorldVerifyRequest {
  proof?: WorldProof;
  idkitResponse?: WorldIdkitResponse;
  action: string;
  signal: Hex64;
  environment?: WorldEnvironment;
}

export interface WorldVerifyResponse {
  ok: boolean;
  /** The verified nullifier when ok. */
  nullifier?: Nullifier;
  /** Failure reason when !ok. */
  detail?: string;
}

export type WorldEnvironment = "production" | "staging";

// ─────────────────────────────────────────────────────────────────────────────
// REST shapes (Phase 2 names the three public reads; mutation routes call executors).
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/switch/[topicId] — the PUBLIC projection. NEVER exposes agent-held
 *  capsules for un-fired rungs (N10): only rung HASHES and, post-release, the one
 *  CAPSULE_PUBLISHED that the watcher already made public via `events`. */
export interface SwitchView {
  topicId: TopicId;
  status: SwitchStatus;
  policyHash: Hex64;
  terms: Terms;
  storage: StorageRef;
  armTime: UnixMs;
  liveIdx: number;
  seq: number;
  /** Null once terminal (released/cancelled). */
  currentDeadline: UnixMs | null;
  /** The public commitment from ARMED. */
  rungHashes: Hex64[];
  /** The audit trail read from the mirror, consensus order. */
  events: SwitchEvent[];
}

/** GET /api/file/[fileId] — streams raw ciphertext bytes (application/octet-stream)
 *  for HFS-stored switches. Body is the bytes; this is the response metadata shape. */
export interface FileProxyMeta {
  fileId: FileId;
  bytes: number;
  contentType: "application/octet-stream";
}

// ─────────────────────────────────────────────────────────────────────────────
// Store — load / save / withLock over data/switches/{topicId}.json.
// ─────────────────────────────────────────────────────────────────────────────

/** The outcome a withLock mutator returns: the state to persist + a value to return. */
export interface StoreMutation<T> {
  /** State to persist atomically. null deletes the record (no-op if absent). */
  next: Switch | null;
  /** Value handed back to the withLock caller. */
  result: T;
}

export type StoreMutator<T> = (
  current: Switch | null,
) => StoreMutation<T> | Promise<StoreMutation<T>>;

export interface SwitchStore {
  load(topicId: TopicId): Promise<Switch | null>;
  /** Atomic: write temp → fsync → rename. Never leaves a half-written file. */
  save(sw: Switch): Promise<void>;
  /** All known topicIds — used by boot-resume to re-attach schedules/watcher. */
  list(): Promise<TopicId[]>;
  /** Serializes read-modify-write per topicId so concurrent mutations can't corrupt. */
  withLock<T>(topicId: TopicId, mutator: StoreMutator<T>): Promise<T>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dependency surfaces the executors call. WS-A (crypto) and WS-B (hedera) own their
// full module APIs; these are the executor-facing slices both sides build/mock to.
// ─────────────────────────────────────────────────────────────────────────────

/** Result of the S4 mirror-verify recipe (see docs/CONTRACTS.md "mirror-verify"). */
export interface MirrorVerifyResult {
  ok: boolean;
  /** tx.result, e.g. "SUCCESS". */
  result?: string;
  /** Decoded memo (null when the tx had no memo — guarded before decode). */
  memo?: string | null;
  checks: {
    success: boolean;
    /** null when no expectedMemo was supplied. */
    memoMatch: boolean | null;
    /** null when no debitAccountId was supplied. */
    debit: boolean | null;
  };
  transactionId?: TxId;
  consensusTimestamp?: string;
  /** "not_found" | "empty" when the tx couldn't be parsed. */
  reason?: string;
}

export interface MirrorTopicMessage {
  sequenceNumber: number;
  consensusTimestamp: string;
  /** base64 message payload. */
  contents: Base64;
}

export interface MirrorTransaction {
  transactionId: TxId;
  result: string;
  /** null when absent — guard before decoding. */
  memoBase64: Base64 | null;
  consensusTimestamp: string;
  transfers: Array<{ account: AccountId; amount: number }>;
}

/** WS-B slice (lib/hedera.ts). All ids are testnet "0.0.x" strings. */
export interface HederaSurface {
  /** Picks HFS fast path or HCS by size (FAST_PATH_MAX_BYTES). */
  storeCiphertext(ciphertext: Uint8Array): Promise<StorageRef>;
  /** Reassembles ciphertext for reveal (HFS proxy or HCS chunk join). */
  readCiphertext(ref: StorageRef): Promise<Uint8Array>;
  /** Creates the switch's audit topic with submitKey = agent (anti-spam). */
  createTopic(): Promise<TopicId>;
  submitEvent(topicId: TopicId, event: SwitchEvent): Promise<{ seq: number; txId: TxId }>;
  /** ScheduleCreate(wrapping TopicMessageSubmit(RELEASE_AUTHORIZED), waitForExpiry, adminKey=agent). */
  scheduleRelease(topicId: TopicId, event: ReleaseAuthorizedEvent, deadline: UnixMs): Promise<ScheduleId>;
  /** ScheduleDelete (needs the admin key). */
  deleteSchedule(scheduleId: ScheduleId): Promise<void>;
  /** The arm/cancel authorization primitive (S4). */
  verifyTransfer(
    txId: TxId,
    opts: { expectedMemo?: string; debitAccountId?: AccountId },
  ): Promise<MirrorVerifyResult>;
  /** Reads the audit trail; afterSeq pages forward (watcher cursor). */
  listTopicMessages(topicId: TopicId, afterSeq?: number): Promise<MirrorTopicMessage[]>;
}

/** WS-A slice (lib/crypto.ts). encrypt/mintLadder are client-only (K never leaves the
 *  browser, never stored). Hashing helpers are deterministic per docs/CONTRACTS.md. */
export interface CryptoSurface {
  /** AES-256-GCM. Returns ciphertext + the ephemeral key K. Client only. */
  encrypt(plaintext: Uint8Array): Promise<{ ciphertext: Uint8Array; key: Uint8Array }>;
  decrypt(ciphertext: Uint8Array, key: Uint8Array): Promise<Uint8Array>;
  /** sha-256(ciphertext) → hex. */
  hashCiphertext(ciphertext: Uint8Array): Hex64;
  /** Mints N rungs: tlock(K, roundAt(armTime + i·intervalSec)) for i=1..N. Client only. */
  mintLadder(key: Uint8Array, armTime: UnixMs, terms: Terms): Promise<LadderRung[]>;
  /** Reveal: tlock-decrypt a published capsule back to K (after its round). */
  openCapsule(capsuleB64: Base64): Promise<Uint8Array>;
  /** sha-256(canonicalJSON(policy)) → hex64. */
  policyHash(policy: Policy): Hex64;
  /** sha-256(canonicalJSON({nextRungHash, newDeadline, topicId, seq})) → hex64. */
  signalHash(nextRungHash: Hex64, newDeadline: UnixMs, topicId: TopicId, seq: number): Hex64;
  /** sha-256(utf8(capsuleB64)) → hex64. */
  capsuleHash(capsuleB64: Base64): Hex64;
}

// ─────────────────────────────────────────────────────────────────────────────
// Executors — arm / checkin / cancel (input, artifacts) → Result.
// Artifact verification sits behind flags until Phase 5 (mocks pass them in Phase 3).
// ─────────────────────────────────────────────────────────────────────────────

/** Flip to true in Phase 5 to enable real on-chain / World verification. */
export interface ExecutorFlags {
  /** Mirror-verify the ARM transfer (SUCCESS + memo match + Ledger debit). */
  verifyArmTx: boolean;
  /** World-verify the check-in proof and re-enforce the signal. */
  verifyCheckinProof: boolean;
  /** Mirror-verify the CANCEL transfer. */
  verifyCancelTx: boolean;
  /** Pay the optional per-check-in service fee + post SERVICE_FEE_PAID. */
  chargeServiceFee: boolean;
}

export interface ExecutorContext {
  store: SwitchStore;
  hedera: HederaSurface;
  crypto: CryptoSurface;
  flags: ExecutorFlags;
  /** Injectable clock (tests pin it; production passes Date.now). */
  now: () => UnixMs;
  /** World verify backend (required when flags.verifyCheckinProof). */
  worldVerify?: (req: WorldVerifyRequest) => Promise<WorldVerifyResponse>;
}

export type ExecErrorCode =
  | "BAD_MEMO" //              arm/cancel memo absent or malformed
  | "POLICY_HASH_MISMATCH" //  recomputed policyHash ≠ memo / input
  | "ARM_TX_UNVERIFIED" //     mirror didn't confirm SUCCESS + debit
  | "WORLD_VERIFY_FAILED" //   /api/v4/verify rejected the proof
  | "WRONG_NULLIFIER" //       proof nullifier ≠ enrolled policy.nullifier
  | "WRONG_SIGNAL" //          recomputed signal ≠ submitted signal
  | "STALE_SEQ" //             input.seq ≠ current seq (replay / out-of-order)
  | "LADDER_EXHAUSTED" //      liveIdx already at N — no rung to advance to
  | "CANCEL_TX_UNVERIFIED" //  mirror didn't confirm the cancel transfer
  | "NOT_FOUND" //             no such switch
  | "NOT_ACTIVE" //            switch already RELEASED or CANCELLED
  | "INTERNAL";

export interface ExecError {
  code: ExecErrorCode;
  message: string;
}

export type ExecResult<T> = { ok: true; value: T } | { ok: false; error: ExecError };

// ── arm ──────────────────────────────────────────────────────────────────────
/** Everything the client assembled: ciphertext already stored, ladder already
 *  minted (K discarded), policy + policyHash computed. */
export interface ArmInput {
  policy: Policy;
  policyHash: Hex64;
  storage: StorageRef;
  ladder: LadderRung[];
  armTime: UnixMs;
}

/** The on-chain proof the executor verifies (behind flags.verifyArmTx). */
export interface ArmArtifacts {
  armTxId: TxId;
  ledgerAccountId: AccountId;
  /** Expected funding (debit ≥ this). */
  fundingHbar: number;
}

export interface ArmResult {
  topicId: TopicId;
  scheduleId: ScheduleId;
  switch: Switch;
}

// ── checkin ──────────────────────────────────────────────────────────────────
export interface CheckinInput {
  topicId: TopicId;
  /** The seq the client believes is current — must equal the stored seq (stale guard). */
  seq: number;
  /** signalHash(nextRungHash, newDeadline, topicId, seq+1); recomputed + re-enforced. */
  signal: Hex64;
}

/** The World proof (behind flags.verifyCheckinProof). */
export interface CheckinArtifacts {
  proof: WorldProof;
  /** Required in the verify body (G0). */
  action: string;
}

export interface CheckinResult {
  seq: number;
  liveIdx: number;
  newDeadline: UnixMs;
  scheduleId: ScheduleId;
}

// ── cancel ───────────────────────────────────────────────────────────────────
export interface CancelInput {
  topicId: TopicId;
}

/** The device-signed cancel transfer (behind flags.verifyCancelTx). */
export interface CancelArtifacts {
  cancelTxId: TxId;
  ledgerAccountId: AccountId;
}

export interface CancelResult {
  topicId: TopicId;
  cancelTxId: TxId;
}

export type ArmExecutor = (
  ctx: ExecutorContext,
  input: ArmInput,
  artifacts: ArmArtifacts,
) => Promise<ExecResult<ArmResult>>;

export type CheckinExecutor = (
  ctx: ExecutorContext,
  input: CheckinInput,
  artifacts: CheckinArtifacts,
) => Promise<ExecResult<CheckinResult>>;

export type CancelExecutor = (
  ctx: ExecutorContext,
  input: CancelInput,
  artifacts: CancelArtifacts,
) => Promise<ExecResult<CancelResult>>;

// ─────────────────────────────────────────────────────────────────────────────
// Memo grammar — DMTT:ARM:<policyHash hex64> · DMTT:CANCEL:<topicId> (both ≤100 B).
// Pure helpers: the only runtime code in this file (contract grammar lives with the types).
// ─────────────────────────────────────────────────────────────────────────────

export const MEMO_ARM_PREFIX = "DMTT:ARM:";
export const MEMO_CANCEL_PREFIX = "DMTT:CANCEL:";

/** "DMTT:ARM:" + 64 hex = 73 bytes ≤ 100. */
export function armMemo(policyHash: Hex64): string {
  return MEMO_ARM_PREFIX + policyHash;
}

/** "DMTT:CANCEL:" + "0.0.x" ≈ 21 bytes ≤ 100. */
export function cancelMemo(topicId: TopicId): string {
  return MEMO_CANCEL_PREFIX + topicId;
}

/** Extracts the policyHash from an arm memo, or null if it isn't a well-formed one. */
export function parseArmMemo(memo: string | null): Hex64 | null {
  if (memo == null || !memo.startsWith(MEMO_ARM_PREFIX)) return null;
  const hash = memo.slice(MEMO_ARM_PREFIX.length);
  return /^[0-9a-f]{64}$/.test(hash) ? hash : null;
}

/** Extracts the topicId from a cancel memo, or null if malformed. */
export function parseCancelMemo(memo: string | null): TopicId | null {
  if (memo == null || !memo.startsWith(MEMO_CANCEL_PREFIX)) return null;
  const topicId = memo.slice(MEMO_CANCEL_PREFIX.length);
  return /^\d+\.\d+\.\d+$/.test(topicId) ? topicId : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Env var names — see CLAUDE.md / .env.example. SERVER_ONLY_SECRETS must NEVER be
// exposed to the client (never NEXT_PUBLIC_*).
// ─────────────────────────────────────────────────────────────────────────────

export const ENV_VARS = [
  "HEDERA_NETWORK",
  "HEDERA_OPERATOR_ID",
  "HEDERA_OPERATOR_KEY",
  "HEDERA_KEY_TYPE",
  "HEDERA_MIRROR_URL",
  "WORLD_APP_ID",
  "WORLD_RP_ID",
  "WORLD_ACTION",
  "WORLD_SIGNING_KEY",
  "WORLD_ENV",
  "ANTHROPIC_API_KEY",
  "NEXT_PUBLIC_WORLD_APP_ID",
  "NEXT_PUBLIC_WORLD_ACTION",
  "NEXT_PUBLIC_WORLD_ENV",
  "NEXT_PUBLIC_WLD_ENVIRONMENT",
] as const;

export type EnvVar = (typeof ENV_VARS)[number];

/** Plaintext, K, the Ledger key, and these never reach the client. */
export const SERVER_ONLY_SECRETS = [
  "HEDERA_OPERATOR_KEY",
  "WORLD_SIGNING_KEY",
  "ANTHROPIC_API_KEY",
] as const satisfies readonly EnvVar[];
