// S2 — Schedule clock: prove waitForExpiry schedules fire at expiry with no trigger,
// a deleted schedule never fires, and an admin-keyless schedule is undeletable.
// Needs HEDERA_OPERATOR_* (testnet). Records the firing lag → the M1/M2 release bound.
//
// Scope note: this isolates the CLOCK with an open (no-submitKey) topic. That the
// scheduled message still fires when submitKey=agent (sigs collected at ScheduleCreate)
// is the N6 hardening verified in WS-B (Phase 3), not here.
import {
  TopicCreateTransaction, TopicMessageSubmitTransaction,
  ScheduleCreateTransaction, ScheduleDeleteTransaction,
  Timestamp,
} from "@hiero-ledger/sdk";
import { hederaClientOrSkip, mirrorGet, section, info, pass, warn, fail, sleep } from "./_lib.mjs";

const EXPIRY_S = 75;          // schedules fire ~75s out — real wait, bounded spike
const POLL_BUDGET_MS = 150_000;

const FIRE = "DMTT-S2-FIRE";
const DELETED = "DMTT-S2-DELETED";
const IMMUTABLE = "DMTT-S2-IMMUTABLE";

async function main() {
  section("S2 · schedule clock (waitForExpiry / delete / immutable)");
  const h = hederaClientOrSkip("S2");
  if (!h) return;
  const { client, operatorId, operatorKey } = h;
  info(`operator ${operatorId.toString()} on ${h.network}`);

  // Open topic (no submitKey) so the scheduled inner submit needs no extra signature.
  const topicId = (await (await new TopicCreateTransaction()
    .setAdminKey(operatorKey.publicKey)
    .execute(client)).getReceipt(client)).topicId;
  info(`topic ${topicId.toString()}`);

  const expiry = Math.floor(Date.now() / 1000) + EXPIRY_S;
  const expiryTs = new Timestamp(expiry, 0);

  // (A) the schedule that SHOULD fire.
  const schedA = await createSchedule(client, topicId, FIRE, expiryTs, operatorKey.publicKey);
  info(`schedule A (fire)      ${schedA.toString()} → expiry ${new Date(expiry * 1000).toISOString()}`);

  // (B) a schedule we delete → must never fire.
  const schedB = await createSchedule(client, topicId, DELETED, expiryTs, operatorKey.publicKey);
  await (await new ScheduleDeleteTransaction().setScheduleId(schedB).execute(client)).getReceipt(client);
  pass(`schedule B (deleted)   ${schedB.toString()} deleted with admin key`);

  // (C) admin-keyless schedule → ScheduleDelete must be rejected SCHEDULE_IS_IMMUTABLE.
  const schedC = await createSchedule(client, topicId, IMMUTABLE, expiryTs, /* adminKey */ null);
  let immutableMsg = "";
  try {
    await (await new ScheduleDeleteTransaction().setScheduleId(schedC).execute(client)).getReceipt(client);
  } catch (e) { immutableMsg = e.status?.toString() || String(e); }
  if (/SCHEDULE_IS_IMMUTABLE/.test(immutableMsg)) pass(`schedule C delete rejected: SCHEDULE_IS_IMMUTABLE`);
  else return fail(`schedule C delete expected SCHEDULE_IS_IMMUTABLE, got: ${immutableMsg || "no error"}`);

  // Wait past expiry, then read the topic from the mirror.
  info(`waiting for expiry (+lag)…`);
  const seen = await pollMessages(topicId, expiry);

  const fire = seen.find((m) => m.text === FIRE);
  if (!fire) return fail(`schedule A message "${FIRE}" never landed`);
  const lagMs = Math.round((fire.tsSeconds - expiry) * 1000);
  pass(`schedule A fired at expiry — observed lag ${lagMs} ms (seq ${fire.seq})`);

  if (seen.some((m) => m.text === DELETED)) return fail(`deleted schedule B fired — "${DELETED}" present!`);
  pass(`deleted schedule B never fired`);

  section("S2 PASS");
  info(`record → release lag ≈ ${lagMs} ms (this becomes the M1/M2 firing bound)`);
  client.close();
}

async function createSchedule(client, topicId, message, expiryTs, adminKey) {
  const inner = new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(message);
  let tx = new ScheduleCreateTransaction()
    .setScheduledTransaction(inner)
    .setExpirationTime(expiryTs)
    .setWaitForExpiry(true);
  if (adminKey) tx = tx.setAdminKey(adminKey);
  return (await (await tx.execute(client)).getReceipt(client)).scheduleId;
}

async function pollMessages(topicId, expirySecs) {
  const deadline = Date.now() + POLL_BUDGET_MS;
  while (Date.now() < deadline) {
    if (Date.now() / 1000 > expirySecs - 2) {
      const { status, json } = await mirrorGet(`/api/v1/topics/${topicId.toString()}/messages?limit=25&order=asc`);
      if (status === 200 && json?.messages?.length) {
        const msgs = json.messages.map((m) => ({
          text: Buffer.from(m.message, "base64").toString("utf8"),
          seq: m.sequence_number,
          tsSeconds: Number(m.consensus_timestamp),
        }));
        if (msgs.some((m) => m.text === FIRE)) return msgs; // fired
      }
    }
    await sleep(3000);
  }
  warn("poll budget elapsed");
  const { json } = await mirrorGet(`/api/v1/topics/${topicId.toString()}/messages?limit=25&order=asc`);
  return (json?.messages || []).map((m) => ({
    text: Buffer.from(m.message, "base64").toString("utf8"),
    seq: m.sequence_number,
    tsSeconds: Number(m.consensus_timestamp),
  }));
}

main().catch((e) => fail(e.stack || String(e)));
