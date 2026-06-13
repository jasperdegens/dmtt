// lib/env.ts — shared, SERVER-ONLY environment access.
//
// NEVER import this from a client component. Server-only secrets (operator key,
// World signing_key, Anthropic key) live here and must never reach the browser
// (CLAUDE.md / CONTRACTS §10). Next.js populates process.env from .env.local
// automatically; for plain-Node contexts (the watcher, node --test, integration
// scripts) this module loads .env.local / .env on first import.

import { readFileSync, existsSync } from "node:fs";
import type { EnvVar } from "./types.ts";

let loaded = false;
function loadDotenvOnce(): void {
  if (loaded) return;
  loaded = true;
  // Next already injects env vars; this is the plain-Node fallback. Real shell
  // vars always win (we never overwrite an already-set key).
  for (const f of [".env.local", ".env"]) {
    try {
      if (!existsSync(f)) continue;
      for (const line of readFileSync(f, "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!m) continue;
        const key = m[1];
        if (key in process.env) continue;
        let val = m[2];
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    } catch {
      /* best-effort: a missing/unreadable env file is fine */
    }
  }
}
loadDotenvOnce();

/** Read an env var, or undefined when unset/blank/placeholder. */
export function env(name: EnvVar | string): string | undefined {
  const v = process.env[name];
  if (v == null) return undefined;
  const t = v.trim();
  if (!t || t.includes("xxxx")) return undefined;
  return t;
}

/** Read a required env var or throw (server boot / executor-flag-gated paths). */
export function requireEnv(name: EnvVar | string): string {
  const v = env(name);
  if (v == null) throw new Error(`missing required env var: ${name}`);
  return v;
}

/** The mirror REST base, derived from HEDERA_MIRROR_URL or HEDERA_NETWORK. */
export function mirrorBase(): string {
  const explicit = env("HEDERA_MIRROR_URL");
  if (explicit) return explicit.replace(/\/$/, "");
  return (env("HEDERA_NETWORK") ?? "testnet").toLowerCase() === "mainnet"
    ? "https://mainnet-public.mirrornode.hedera.com"
    : "https://testnet.mirrornode.hedera.com";
}

/** True when Hedera operator credentials are present (gates live on-chain ops). */
export function hasHederaCreds(): boolean {
  return env("HEDERA_OPERATOR_ID") != null && env("HEDERA_OPERATOR_KEY") != null;
}

/** True when World backend credentials are present (gates live World verify). */
export function hasWorldCreds(): boolean {
  return env("WORLD_SIGNING_KEY") != null && env("WORLD_RP_ID") != null;
}
