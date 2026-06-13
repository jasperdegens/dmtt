// S3 — HFS seal path: create→append→seal. Proves the create→append→FileUpdate(empty
// KeyList) sequence (C2), byte-identical round-trip, post-seal immutability, and the
// ≤4 KB single-create-immutable fast path. Needs HEDERA_OPERATOR_* (testnet).
import crypto from "node:crypto";
import {
  FileCreateTransaction, FileAppendTransaction, FileUpdateTransaction,
  FileContentsQuery, KeyList,
} from "@hiero-ledger/sdk";
import { hederaClientOrSkip, section, info, pass, fail } from "./_lib.mjs";

async function main() {
  section("S3 · HFS create → append → seal");
  const h = hederaClientOrSkip("S3");
  if (!h) return;
  const { client, operatorKey } = h;

  // ── Fast path: ≤4 KB single FileCreate with empty KeyList = immutable from creation ──
  const small = crypto.randomBytes(2048);
  const smallId = (await (await new FileCreateTransaction()
    .setKeys(new KeyList())          // empty KeyList → immutable immediately
    .setContents(small)
    .execute(client)).getReceipt(client)).fileId;
  info(`fast-path file ${smallId.toString()} (2 KB, immutable-from-creation)`);

  const smallBack = await new FileContentsQuery().setFileId(smallId).execute(client);
  if (!Buffer.from(smallBack).equals(small)) return fail("fast-path read not byte-identical");
  pass("fast-path 2 KB byte-identical round-trip");

  if (!(await rejected(() =>
    new FileAppendTransaction().setFileId(smallId).setContents(crypto.randomBytes(16)).execute(client).then((r) => r.getReceipt(client)),
  ))) return fail("fast-path FileAppend should have been rejected (immutable)");
  pass("fast-path FileAppend rejected (immutable)");

  // ── Large path: create(agent key) → append 100 KB → seal (FileUpdate empty KeyList) ──
  const data = crypto.randomBytes(100 * 1024);
  const head = data.subarray(0, 2000);
  const rest = data.subarray(2000);

  const bigId = (await (await new FileCreateTransaction()
    .setKeys(operatorKey.publicKey)  // agent-keyed so it can be appended
    .setContents(head)
    .execute(client)).getReceipt(client)).fileId;
  info(`seal-path file ${bigId.toString()} created (agent-keyed)`);

  await (await new FileAppendTransaction()
    .setFileId(bigId)
    .setContents(rest)
    .setMaxChunks(40)                // 100 KB / 4 KB ≈ 25 chunks
    .execute(client)).getReceipt(client);
  info(`appended ${rest.length} bytes in chunks`);

  const preSeal = await new FileContentsQuery().setFileId(bigId).execute(client);
  if (!Buffer.from(preSeal).equals(data)) return fail("pre-seal 100 KB read not byte-identical");
  pass("pre-seal 100 KB byte-identical round-trip");

  // Seal: FileUpdate with empty KeyList → "the file SHALL be immutable after completion".
  await (await new FileUpdateTransaction()
    .setFileId(bigId)
    .setKeys(new KeyList())
    .execute(client)).getReceipt(client);
  pass("sealed via FileUpdate(empty KeyList)");

  const postSeal = await new FileContentsQuery().setFileId(bigId).execute(client);
  if (!Buffer.from(postSeal).equals(data)) return fail("post-seal read not byte-identical");
  pass("post-seal 100 KB still byte-identical");

  if (!(await rejected(() =>
    new FileAppendTransaction().setFileId(bigId).setContents(crypto.randomBytes(16)).execute(client).then((r) => r.getReceipt(client)),
  ))) return fail("post-seal FileAppend should have been rejected");
  pass("post-seal FileAppend rejected");

  if (!(await rejected(() =>
    new FileUpdateTransaction().setFileId(bigId).setContents(crypto.randomBytes(16)).execute(client).then((r) => r.getReceipt(client)),
  ))) return fail("post-seal FileUpdate should have been rejected");
  pass("post-seal FileUpdate rejected");

  section("S3 PASS");
  info("record → create→append→seal works; immutable file rejects both append & update");
  client.close();
}

// returns true if the thunk throws (a transaction rejection), false if it succeeds.
async function rejected(thunk) {
  try { await thunk(); return false; }
  catch (e) { info(`   rejected with: ${e.status?.toString() || String(e).split("\n")[0]}`); return true; }
}

main().catch((e) => fail(e.stack || String(e)));
