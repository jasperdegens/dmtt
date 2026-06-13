// test/memo-grammar.test.ts — pure memo builders/parsers from lib/types.ts.
// Grammar: DMTT:ARM:<64-hex policyHash> · DMTT:CANCEL:<topicId "d.d.d">.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  armMemo,
  cancelMemo,
  parseArmMemo,
  parseCancelMemo,
  MEMO_ARM_PREFIX,
  MEMO_CANCEL_PREFIX,
  MEMO_MAX_BYTES,
} from "../lib/types.ts";

const HASH = "5e69cb3137841c36cc5a6aafcea18e8d81f5dbe654eca0f4e64f652539ba5285";
const TOPIC = "0.0.7777777";

// ── builders ─────────────────────────────────────────────────────────────────

test("armMemo builds exact DMTT:ARM:<hash> string", () => {
  assert.equal(armMemo(HASH), "DMTT:ARM:" + HASH);
  assert.equal(MEMO_ARM_PREFIX, "DMTT:ARM:");
  assert.ok(armMemo(HASH).startsWith(MEMO_ARM_PREFIX));
});

test("cancelMemo builds exact DMTT:CANCEL:<topicId> string", () => {
  assert.equal(cancelMemo(TOPIC), "DMTT:CANCEL:" + TOPIC);
  assert.equal(MEMO_CANCEL_PREFIX, "DMTT:CANCEL:");
  assert.ok(cancelMemo(TOPIC).startsWith(MEMO_CANCEL_PREFIX));
});

// ── round-trip ───────────────────────────────────────────────────────────────

test("parseArmMemo round-trips a valid 64-hex hash", () => {
  assert.equal(parseArmMemo(armMemo(HASH)), HASH);
  // all-zero and all-f boundaries
  assert.equal(parseArmMemo(armMemo("0".repeat(64))), "0".repeat(64));
  assert.equal(parseArmMemo(armMemo("f".repeat(64))), "f".repeat(64));
});

test("parseCancelMemo round-trips a valid 0.0.x topicId", () => {
  assert.equal(parseCancelMemo(cancelMemo(TOPIC)), TOPIC);
  assert.equal(parseCancelMemo(cancelMemo("0.0.1")), "0.0.1");
  assert.equal(parseCancelMemo(cancelMemo("12.34.56")), "12.34.56");
});

// ── arm rejections (must return null) ────────────────────────────────────────

test("parseArmMemo rejects null and empty", () => {
  assert.equal(parseArmMemo(null), null);
  assert.equal(parseArmMemo(""), null);
});

test("parseArmMemo rejects wrong / missing prefix", () => {
  assert.equal(parseArmMemo(HASH), null); // no prefix at all
  assert.equal(parseArmMemo("DMTT:CANCEL:" + HASH), null); // wrong prefix
  assert.equal(parseArmMemo("dmtt:arm:" + HASH), null); // lowercase prefix
  assert.equal(parseArmMemo("DMTT:ARM" + HASH), null); // missing colon
});

test("parseArmMemo rejects uppercase hex (must be lowercase)", () => {
  assert.equal(parseArmMemo(armMemo(HASH.toUpperCase())), null);
  assert.equal(
    parseArmMemo("DMTT:ARM:" + "A".repeat(64)),
    null,
  );
});

test("parseArmMemo rejects wrong-length hashes (63, 65)", () => {
  assert.equal(parseArmMemo("DMTT:ARM:" + "a".repeat(63)), null);
  assert.equal(parseArmMemo("DMTT:ARM:" + "a".repeat(65)), null);
  assert.equal(parseArmMemo("DMTT:ARM:"), null); // empty hash
});

test("parseArmMemo rejects non-hex characters", () => {
  assert.equal(parseArmMemo("DMTT:ARM:" + "g".repeat(64)), null);
  assert.equal(parseArmMemo("DMTT:ARM:" + "z" + "a".repeat(63)), null);
  // 0x-prefixed (would shift length and inject 'x')
  assert.equal(parseArmMemo("DMTT:ARM:0x" + "a".repeat(62)), null);
});

test("parseArmMemo rejects trailing garbage after a valid hash", () => {
  assert.equal(parseArmMemo("DMTT:ARM:" + HASH + " "), null);
  assert.equal(parseArmMemo("DMTT:ARM:" + HASH + "00"), null);
  assert.equal(parseArmMemo("DMTT:ARM:" + HASH + "\n"), null);
});

test("parseArmMemo rejects a cancel memo (cross-parse)", () => {
  assert.equal(parseArmMemo(cancelMemo(TOPIC)), null);
});

// ── cancel rejections (must return null) ─────────────────────────────────────

test("parseCancelMemo rejects null and empty", () => {
  assert.equal(parseCancelMemo(null), null);
  assert.equal(parseCancelMemo(""), null);
});

test("parseCancelMemo rejects wrong / missing prefix", () => {
  assert.equal(parseCancelMemo(TOPIC), null);
  assert.equal(parseCancelMemo("DMTT:ARM:" + TOPIC), null);
  assert.equal(parseCancelMemo("dmtt:cancel:" + TOPIC), null);
});

test("parseCancelMemo rejects topicIds not matching d.d.d", () => {
  assert.equal(parseCancelMemo("DMTT:CANCEL:0.0"), null); // too few segments
  assert.equal(parseCancelMemo("DMTT:CANCEL:0.0.0.0"), null); // too many
  assert.equal(parseCancelMemo("DMTT:CANCEL:0.0.x"), null); // non-digit
  assert.equal(parseCancelMemo("DMTT:CANCEL:a.b.c"), null);
  assert.equal(parseCancelMemo("DMTT:CANCEL:"), null); // empty
  assert.equal(parseCancelMemo("DMTT:CANCEL:0.0.1 "), null); // trailing space
  assert.equal(parseCancelMemo("DMTT:CANCEL:0.0.1-2"), null); // trailing garbage
});

test("parseCancelMemo rejects an arm memo (cross-parse)", () => {
  assert.equal(parseCancelMemo(armMemo(HASH)), null);
});

// ── byte-length invariant ────────────────────────────────────────────────────

test("arm memo for a 64-hex hash is 73 bytes <= MEMO_MAX_BYTES (100)", () => {
  assert.equal(MEMO_MAX_BYTES, 100);
  const memo = armMemo("f".repeat(64));
  assert.equal(Buffer.byteLength(memo, "utf8"), 73);
  assert.ok(Buffer.byteLength(memo, "utf8") <= MEMO_MAX_BYTES);
});

test("cancel memo for a realistic topicId is <= MEMO_MAX_BYTES", () => {
  const memo = cancelMemo("0.0.7777777");
  assert.ok(Buffer.byteLength(memo, "utf8") <= MEMO_MAX_BYTES);
  // even an unusually large id stays well under the cap
  assert.ok(Buffer.byteLength(cancelMemo("99999.99999.99999999"), "utf8") <= MEMO_MAX_BYTES);
});
