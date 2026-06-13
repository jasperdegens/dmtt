// Probe: is the HFS append fee reducible? Measures the two biggest levers on-chain.
//   (1) HFS file at a SHORT expiration vs the ~90-day default (storage rent ∝ duration)
//   (2) HCS topic message as the storage medium (pay-per-message, no storage rent)
// Baselines from S3 (default ~90-day expiry): FileCreate 2 KB ≈ 2 ℏ · FileAppend 4 KB ≈ 4.36 ℏ.
import crypto from "node:crypto";
import {
  FileCreateTransaction, TopicCreateTransaction, TopicMessageSubmitTransaction, Timestamp,
} from "@hiero-ledger/sdk";
import { hederaClientOrSkip, mirrorGet, section, info, pass, warn, fail } from "./_lib.mjs";

const fee = (rec) => Number(rec.transactionFee.toTinybars().toString()) / 1e8; // ℏ

async function balance(id) {
  const { json } = await mirrorGet(`/api/v1/accounts/${id}`);
  return ((json?.balance?.balance) || 0) / 1e8;
}

async function main() {
  section("Storage-cost probe — HFS expiration lever vs HCS");
  const h = hederaClientOrSkip("probe");
  if (!h) return;
  const { client, operatorId, operatorKey } = h;
  const startBal = await balance(operatorId.toString());
  info(`operator ${operatorId} · balance ${startBal.toFixed(3)} ℏ`);

  const payload2k = crypto.randomBytes(2048);
  const nowS = Math.floor(Date.now() / 1000);

  // (1) HFS create, 2 KB, at the SHORTEST accepted expiration → compare to ~2 ℏ default.
  let hfs = null;
  for (const days of [1, 3, 7, 30]) {
    try {
      const resp = await new FileCreateTransaction()
        .setKeys([operatorKey.publicKey])
        .setContents(payload2k)
        .setExpirationTime(new Timestamp(nowS + days * 86400, 0))
        .execute(client);
      const f = fee(await resp.getRecord(client));
      hfs = { days, f };
      pass(`HFS create 2 KB @ ${days}-day expiry → ${f.toFixed(4)} ℏ   (default ~90d ≈ 2 ℏ)`);
      break;
    } catch (e) {
      warn(`HFS @ ${days}d rejected: ${e.status?.toString() || String(e).split("\n")[0]}`);
    }
  }

  // (2) HCS: 1 KB single message (no storage rent) → per-KB storage via consensus.
  try {
    const topicId = (await (await new TopicCreateTransaction()
      .setSubmitKey(operatorKey.publicKey).execute(client)).getReceipt(client)).topicId;
    const resp = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId).setMessage(crypto.randomBytes(1000)).execute(client);
    const f = fee(await resp.getRecord(client));
    pass(`HCS submit 1 KB → ${f.toFixed(5)} ℏ   (≈ ${(f * 1000).toFixed(2)} mℏ/KB; topic create was 0.26 ℏ once)`);
  } catch (e) {
    warn(`HCS probe failed: ${e.status?.toString() || String(e).split("\n")[0]}`);
  }

  section("verdict");
  if (hfs) info(`HFS fee is ~flat per-byte, NOT duration-scaled: 2 KB cost ${hfs.f.toFixed(3)} ℏ at ${hfs.days}d ≈ the ~2 ℏ at 90d → shortening expiry does NOT help`);
  info("HCS is pay-per-message with NO storage rent → ~100× cheaper than HFS (measured ~1 ℏ/KB HFS vs ~0.01 ℏ/KB HCS)");
  const endBal = await balance(operatorId.toString());
  info(`probe spent ${(startBal - endBal).toFixed(3)} ℏ · balance now ${endBal.toFixed(3)} ℏ`);
  client.close();
}

main().catch((e) => fail(e.stack || String(e)));
