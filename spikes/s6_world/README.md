# S6 — World ID 4.0 staging spike

Splits into an **agent-owned backend** (done + verified) and a **human-owned Simulator
flow** (the `S6 | HUMAN ~15 min` lane in PLAN.md).

## Status

- ✅ **Backend signing + verify wiring** — `node spikes/s6_world/sign_check.mjs`
  - backend signs `rp_context` with the server-only `signing_key` (never shipped to client)
  - nonce unique per request
  - v4 verify endpoint reachable for `rp_85dfa1530e42d8b2` (rejects a bogus proof with a
    structured `400`)
- ⏳ **Human Simulator flow** — the proof round-trip + the two negatives.

## Finding to carry into Phase 5 / CONTRACTS

The verify endpoint requires `action` in the POST body, not just the proof:

```
POST https://developer.world.org/api/v4/verify/{rp_id}
400 {"code":"validation_error","detail":"action is required for uniqueness proofs","attribute":"action"}
```

So "forward the proof as-is" (CLAUDE.md) means **forward the proof fields unmodified AND
include `action`** (and the bound `signal`) at the top level. `server.mjs` does this.

## Human runbook (~15 min, do in Chrome)

1. `node spikes/s6_world/server.mjs` → open `http://localhost:8676`.
2. Click **GET rp_context** — confirm a signed context returns (proves the backend path).
3. **Triple-match** (silent failure if any leg differs): IDKit `environment:"staging"`
   ⟷ the **staging** `check-in` action ⟷ proofs from the **Simulator**
   (`https://simulator.worldcoin.org`), via the `app_mode:"external"` QR/connect flow.
4. Generate a proof in the Simulator with a known `signal`
   (`hash(nextRungHash ‖ newDeadline ‖ topicId ‖ seq)`), paste the IDKit success result
   into the page, click **Verify**.
   - **PASS:** `upstreamStatus 200` + a `nullifier` (the canonical identifier — store
     `(action, nullifier)` with a uniqueness check; it's a uint256 decimal string).
5. **Negative — replay:** paste the *same* proof again → must be **REJECTED**.
6. **Negative — wrong signal:** generate a proof with a *different* signal → must be
   **REJECTED** by the backend signal re-enforcement.
7. **Repeatability:** verify the same human ×3 → the **same nullifier** each time.
8. Flip `WORLD_ENV=production` + the production action and confirm the real World App path
   too (the staging/production toggle from CLAUDE.md).

## Why this exclusion matters (judge line)

We deliberately do **not** use `@worldcoin/agentkit` — it exists to delegate proof-of-human
to agents, the one thing a dead man's switch must never allow. Check-ins are human-only.
