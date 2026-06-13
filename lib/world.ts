// lib/world.ts — WS-E: the World ID 4.0 backend (SERVER-ONLY).
//
// Two jobs (mirrors spikes/s6_world/server.mjs, verified on staging):
//   1. signRpContext() — the backend signs rp_context with the server-only
//      signing_key (signRequest from @worldcoin/idkit-core/signing). The key is
//      NEVER NEXT_PUBLIC_* and never leaves the server (CLAUDE.md / CONTRACTS §9).
//   2. verifyWorldProof() — forwards the full IDKit response AS-IS (no re-encoding)
//      plus the top-level `action` (G0: without it /verify 400s "action is required")
//      and WORLD_ENV, to https://developer.world.org/api/v4/verify/{rp_id}.
//
// buildVerifyPayload is split out as a PURE, testable helper (the G0 shape).
// Relative imports, explicit .ts extensions, no @/ in lib/**.

import { signRequest } from "@worldcoin/idkit-core/signing";
import { env, hasWorldCreds } from "./env.ts";
import type {
  Nullifier,
  RpContextResponse,
  WorldEnvironment,
  WorldVerifyRequest,
  WorldVerifyResponse,
} from "./types.ts";

const VERIFY_BASE = "https://developer.world.org/api/v4/verify";

export function worldEnvironment(): WorldEnvironment {
  return env("WORLD_ENV") === "staging" ? "staging" : "production";
}

/** Backend-signed rp_context. Uses WORLD_SIGNING_KEY (strip 0x) + WORLD_ACTION;
 *  returns { rp_id: WORLD_RP_ID, nonce, created_at, expires_at, signature }.
 *  THROWS when World isn't configured (the route maps that to 503). */
export function signRpContext(): RpContextResponse {
  if (!hasWorldCreds()) throw new Error("world not configured");
  const rpId = env("WORLD_RP_ID");
  const signingKeyHex = (env("WORLD_SIGNING_KEY") ?? "").replace(/^0x/, "");
  const action = env("WORLD_ACTION") ?? "check-in";
  if (!rpId || !signingKeyHex) throw new Error("world not configured");

  // signRequest returns { sig, nonce, createdAt, expiresAt } (numeric timestamps);
  // map it to the frozen RpContextResponse string shape.
  const s = signRequest({ signingKeyHex, action });
  return {
    rp_id: rpId,
    nonce: String(s.nonce),
    created_at: String(s.createdAt),
    expires_at: String(s.expiresAt),
    signature: String(s.sig),
  };
}

/** PURE: the exact body posted to /api/v4/verify. Real IDKit v4 requests preserve
 *  `responses[]`; the compact proof path remains only for legacy/internal callers. */
export function buildVerifyPayload(
  req: WorldVerifyRequest,
  environment: WorldEnvironment = req.environment ?? worldEnvironment(),
): Record<string, unknown> {
  if (req.idkitResponse) {
    return { ...req.idkitResponse, action: req.action, environment };
  }
  if (!req.proof) throw new Error("missing proof or idkitResponse");
  return { ...req.proof, action: req.action, signal: req.signal, environment };
}

export function nullifierFromVerifyRequest(req: WorldVerifyRequest): Nullifier | undefined {
  if (req.proof) return req.proof.nullifier_hash;
  const first = req.idkitResponse?.responses[0];
  const nullifier = first?.nullifier;
  if (typeof nullifier === "string") return nullifier;
  const sessionNullifier = first?.session_nullifier;
  if (Array.isArray(sessionNullifier) && typeof sessionNullifier[0] === "string") {
    return sessionNullifier[0];
  }
  return undefined;
}

/** POST the verify payload to the World endpoint. ok ⟺ upstream status 200.
 *  Returns { ok, nullifier? (the proof's nullifier when ok), detail? (the
 *  upstream text when !ok) }. When World isn't configured: { ok:false, ... } with
 *  no network call. `fetchFn` is injectable for tests. */
export async function verifyWorldProof(
  req: WorldVerifyRequest,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<WorldVerifyResponse> {
  if (!hasWorldCreds()) return { ok: false, detail: "world not configured" };
  const rpId = env("WORLD_RP_ID");
  if (!rpId) return { ok: false, detail: "world not configured" };

  const payload = buildVerifyPayload(req);
  const res = await fetchFn(`${VERIFY_BASE}/${rpId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const ok = res.status === 200;
  if (ok) return { ok: true, nullifier: nullifierFromVerifyRequest(req) };

  let detail = `verify failed (status ${res.status})`;
  try {
    const text = await res.text();
    if (text) detail = text;
  } catch {
    /* keep the status-based detail */
  }
  return { ok: false, detail };
}
