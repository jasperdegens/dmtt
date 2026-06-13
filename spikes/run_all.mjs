// Runs every agent-owned spike in sequence. Credential-gated spikes self-skip (exit 0)
// when their secrets are absent, so this is safe to run with a partial .env.local.
import { spawnSync } from "node:child_process";
import { section, info, pass, fail, warn } from "./_lib.mjs";

const SPIKES = [
  ["S4 · mirror helper", "spikes/s4_mirror.mjs"],
  ["S5 · tlock", "spikes/s5_tlock.mjs"],
  ["S6 · world backend", "spikes/s6_world/sign_check.mjs"],
  ["S2 · schedule clock", "spikes/s2_schedule.mjs"],
  ["S3 · hfs seal", "spikes/s3_hfs.mjs"],
];

const results = [];
for (const [name, path] of SPIKES) {
  const r = spawnSync(process.execPath, [path], { stdio: "inherit" });
  results.push([name, r.status === 0]);
}

section("G0 · agent-owned spike summary");
for (const [name, ok] of results) (ok ? pass : fail)(`${name}`);
warn("'ok' may mean self-skipped (missing secrets) — read each block above.");
info("HUMAN-owned: S1 (Ledger device ceremony) + S6 Simulator flow — see spikes/README.md");
if (results.some(([, ok]) => !ok)) process.exitCode = 1;
