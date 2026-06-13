// S5 — tlock: encrypt a 32 B key to a future drand round, prove the seal holds
// before the round, decrypt after. Public drand quicknet → no secrets needed.
//
// Pass criteria (PLAN.md): exact round-trip; armored capsule size recorded;
// (added) pre-round decrypt must FAIL — that failure IS the confidentiality seal.
import crypto from "node:crypto";
import {
  mainnetClient, defaultChainInfo, defaultChainUrl,
  roundAt, roundTime, timelockEncrypt, timelockDecrypt, Buffer,
} from "tlock-js";
import { section, info, pass, fail, sleep } from "./_lib.mjs";

const PERIOD = defaultChainInfo.period;   // 3s on quicknet
const DELAY_MS = 24_000;                  // ~8 rounds out: a real wait, still a fast spike

async function main() {
  section("S5 · tlock — seal a 32 B key to a future drand round");
  info(`chain: ${defaultChainInfo.metadata.beaconID} · ${defaultChainInfo.schemeID} · period ${PERIOD}s`);
  info(`hash : ${defaultChainInfo.hash}`);

  const client = mainnetClient(); // tlock-js 0.9.0: mainnetClient() === quicknet
  const K = crypto.randomBytes(32); // the ladder key: random AES-256, in memory only

  // roundForTime(t) is roundAt(t_ms, chainInfo) in this SDK. Self-check the mapping.
  const targetMs = Date.now() + DELAY_MS;
  const round = roundAt(targetMs, defaultChainInfo);
  const backMs = roundTime(defaultChainInfo, round);
  if (Math.abs(backMs - targetMs) > PERIOD * 1000) {
    return fail(`roundAt/roundTime mapping off (roundTime=${backMs} vs target=${targetMs}) — check arg order`);
  }
  info(`target round ${round} → fires ~${new Date(backMs).toISOString()} (${Math.round((backMs - Date.now()) / 1000)}s out)`);

  // Encrypt and record the armored capsule size (this is one ladder rung).
  const capsule = await timelockEncrypt(round, Buffer.from(K), client);
  const capsuleBytes = Buffer.byteLength(capsule, "utf8");
  info(`armored capsule: ${capsuleBytes} bytes`);

  // NEGATIVE: decrypt before the round must be rejected — the seal.
  let early = "decrypted (BAD)";
  try { await timelockDecrypt(capsule, client); }
  catch { early = "rejected"; }
  if (early !== "rejected") return fail("capsule decrypted BEFORE its round — timelock not holding!");
  pass("pre-round decrypt correctly rejected (confidentiality seal holds)");

  // Wait for the round to be published, then decrypt.
  await waitForRound(round);
  const out = await timelockDecrypt(capsule, client);
  if (!Buffer.from(out).equals(K)) return fail("decrypted key != original K");
  pass(`post-round round-trip byte-identical (K=${K.toString("hex").slice(0, 16)}…)`);

  section("S5 PASS");
  info(`record → capsule ≈ ${capsuleBytes} B/rung · period ${PERIOD}s · time→round helper = roundAt (NOT roundForTime)`);
}

async function waitForRound(round) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const r = await fetch(`${defaultChainUrl}/public/latest`).then((x) => x.json()).catch(() => null);
    if (r && r.round >= round) { info(`drand latest round ${r.round} ≥ ${round}`); return; }
    await sleep(2000);
  }
  throw new Error("timed out waiting for drand round to publish");
}

main().catch((e) => fail(e.stack || String(e)));
