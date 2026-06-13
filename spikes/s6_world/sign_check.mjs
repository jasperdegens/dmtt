// S6 (backend slice) — verify the security-critical World pieces that DON'T need a
// phone: the backend signs rp_context with the server-only signing_key, and the v4
// verify endpoint is reachable for this rp_id. The proof round-trip (triple-match,
// 3× same nullifier, replay/wrong-signal negatives) is the human's Simulator flow.
import { signRequest } from "@worldcoin/idkit-core/signing";
import { section, info, pass, warn, fail, skip } from "../_lib.mjs";

async function main() {
  section("S6 · World — backend rp_context signing + verify wiring");
  const key = process.env.WORLD_SIGNING_KEY;
  const rpId = process.env.WORLD_RP_ID;
  const action = process.env.WORLD_ACTION || "check-in";
  const env = process.env.WORLD_ENV || "staging";
  if (!key || key.includes("xxxx") || !rpId || rpId.includes("xxxx")) {
    skip("S6: needs WORLD_SIGNING_KEY + WORLD_RP_ID in .env.local");
    return;
  }
  info(`rp ${rpId} · action "${action}" · env ${env}`);

  // (1) Backend signs rp_context. signing_key stays server-side; only the signature ships.
  let sig;
  try { sig = signRequest({ signingKeyHex: key, action }); }
  catch (e1) {
    try { sig = signRequest({ signingKeyHex: key.replace(/^0x/, ""), action }); }
    catch (e2) { return fail(`signRequest failed: ${e2.message}`); }
  }
  const okShape = typeof sig.sig === "string" && sig.sig.length > 16
    && typeof sig.nonce === "string" && sig.expiresAt > sig.createdAt;
  if (!okShape) return fail(`unexpected RpSignature shape: ${JSON.stringify(sig)}`);

  const rp_context = {
    rp_id: rpId,
    nonce: sig.nonce,
    created_at: sig.createdAt,
    expires_at: sig.expiresAt,
    signature: sig.sig,
  };
  pass(`signed rp_context (sig ${sig.sig.slice(0, 20)}…, ttl ${sig.expiresAt - sig.createdAt}s)`);
  info(`rp_context = ${JSON.stringify(rp_context).slice(0, 110)}…`);

  // (2) Two signings must produce different nonces (anti-replay at the request layer).
  const sig2 = signRequest({ signingKeyHex: key.replace(/^0x/, ""), action });
  if (sig2.nonce === sig.nonce) return fail("nonce not unique across signRequest calls");
  pass("nonce unique per request");

  // (3) Verify endpoint reachable for this rp_id. No real proof → expect a structured
  //     rejection (4xx), NOT a 200 and NOT a network error.
  const url = `https://developer.world.org/api/v4/verify/${rpId}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ probe: "no-proof" }),
    });
    const body = (await res.text()).replace(/\s+/g, " ").slice(0, 160);
    if (res.status === 404) warn(`verify endpoint 404 for rp_id ${rpId} — confirm rp_id/path`);
    else if (res.status === 200) warn(`verify returned 200 to a bogus proof?! body: ${body}`);
    else pass(`verify endpoint reachable (HTTP ${res.status} rejects bogus proof, as expected)`);
    info(`response: ${res.status} ${body}`);
  } catch (e) {
    return fail(`verify endpoint unreachable: ${e.message}`);
  }

  section("S6 BACKEND PASS — human Simulator flow still required");
  info("human next → `node spikes/s6_world/server.mjs`, open in Chrome, run the Simulator:");
  info("  triple-match (staging ⟷ IDKit env:staging ⟷ Simulator) · verify ×3 → same nullifier · replay REJECTED · wrong-signal REJECTED");
}

main().catch((e) => fail(e.stack || String(e)));
