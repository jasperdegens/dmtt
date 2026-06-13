// S6 harness for the HUMAN Simulator flow. Serves the two backend routes the agent
// owns (verified by sign_check.mjs) plus a tiny page to drive + test them:
//   GET  /                      → control page (get rp_context, paste a proof, verify)
//   POST /api/world/rp_context  → backend-signed rp_context (signing_key stays server-side)
//   POST /api/world/verify      → forwards the proof AS-IS (+ required `action`) to v4 verify
//
// Run:  node spikes/s6_world/server.mjs   then open http://localhost:8676 in CHROME.
import http from "node:http";
import { signRequest } from "@worldcoin/idkit-core/signing";
import "../_lib.mjs"; // side-effect: loads .env.local

const PORT = Number(process.env.S6_PORT || 8676);
const RP_ID = process.env.WORLD_RP_ID;
const ACTION = process.env.WORLD_ACTION || "check-in";
const KEY = (process.env.WORLD_SIGNING_KEY || "").replace(/^0x/, "");
const ENV = process.env.WORLD_ENV || "staging";
const APP_ID = process.env.NEXT_PUBLIC_WORLD_APP_ID || process.env.WORLD_APP_ID;
const VERIFY_URL = `https://developer.world.org/api/v4/verify/${RP_ID}`;

if (!KEY || !RP_ID) {
  console.error("✗ set WORLD_SIGNING_KEY + WORLD_RP_ID in .env.local first");
  process.exit(1);
}

const send = (res, status, obj) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({ __raw: b }); } });
  });

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(PAGE);
    }
    // Backend signs rp_context — the signing_key NEVER leaves this process.
    if (req.method === "POST" && req.url === "/api/world/rp_context") {
      const s = signRequest({ signingKeyHex: KEY, action: ACTION });
      return send(res, 200, { rp_id: RP_ID, nonce: s.nonce, created_at: s.createdAt, expires_at: s.expiresAt, signature: s.sig });
    }
    // Forward the proof AS-IS (no re-encoding); merge in the `action` the endpoint requires.
    if (req.method === "POST" && req.url === "/api/world/verify") {
      const proof = await readBody(req);
      const payload = { action: ACTION, ...proof };
      const r = await fetch(VERIFY_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const text = await r.text();
      let body; try { body = JSON.parse(text); } catch { body = text; }
      return send(res, 200, { upstreamStatus: r.status, ok: r.status === 200, body });
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`S6 World harness → http://localhost:${PORT}  (open in Chrome)`);
  console.log(`  app ${APP_ID} · rp ${RP_ID} · action "${ACTION}" · env ${ENV}`);
  console.log(`  verify upstream: ${VERIFY_URL}`);
});

const PAGE = `<!doctype html><meta charset=utf-8><title>S6 World harness</title>
<style>body{font:14px ui-monospace,monospace;max-width:760px;margin:32px auto;padding:0 16px;line-height:1.5}
button{font:inherit;padding:6px 12px;margin:4px 0;cursor:pointer}textarea{width:100%;height:160px;font:inherit}
pre{background:#1113;padding:10px;border-radius:6px;overflow:auto;white-space:pre-wrap}h2{margin-top:28px}</style>
<h1>S6 · World staging harness</h1>
<p>env <b>${ENV}</b> · app <code>${APP_ID}</code> · rp <code>${RP_ID}</code> · action <code>${ACTION}</code></p>
<p><b>Triple-match reminder:</b> IDKit must use <code>environment:"${ENV}"</code>, proofs come from the
<b>${ENV === "staging" ? "Simulator (simulator.worldcoin.org)" : "real World App"}</b>, and the action must be the <b>${ENV}</b> action.</p>

<h2>1 · rp_context (backend-signed)</h2>
<button onclick="getCtx()">GET rp_context</button>
<pre id=ctx>—</pre>

<h2>2 · verify a proof</h2>
<p>Drive the Simulator per <a href="https://docs.world.org/world-id/SKILL.md">SKILL.md</a> (signal binding =
<code>hash(nextRungHash ‖ newDeadline ‖ topicId ‖ seq)</code>), paste the IDKit success result below, and Verify.
First paste → expect <code>upstreamStatus 200</code> + a <b>nullifier</b>. Paste the <b>same</b> proof again → expect
<b>REJECTED</b> (replay). A proof made with a <b>different signal</b> → expect <b>REJECTED</b>.</p>
<textarea id=proof placeholder='{ "proof": [...], "merkle_root": "...", "nullifier_hash": "...", ... }'></textarea>
<button onclick="verify()">POST /api/world/verify</button>
<pre id=out>—</pre>

<script>
async function getCtx(){
  const r = await fetch('/api/world/rp_context',{method:'POST'});
  document.getElementById('ctx').textContent = JSON.stringify(await r.json(),null,2);
}
async function verify(){
  let proof; try{ proof = JSON.parse(document.getElementById('proof').value); }
  catch(e){ return document.getElementById('out').textContent='invalid JSON: '+e; }
  const r = await fetch('/api/world/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(proof)});
  document.getElementById('out').textContent = JSON.stringify(await r.json(),null,2);
}
</script>`;
