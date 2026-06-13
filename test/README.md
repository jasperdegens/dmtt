# test/ — frozen-contract suite

Runtime tests over the parts of the Phase 2 frozen contract that exist today:
`lib/types.ts` (pure memo grammar, pinned constants, env invariants) and
`lib/fixtures.ts` (one fixture per contract, encoding the real invariants from
`CLAUDE.md` / `docs/CONTRACTS.md`). No Phase 3 code is referenced.

## Run

```sh
pnpm test
```

Uses Node 22's built-in test runner (`node:test` + `node:assert/strict`) with
native TypeScript type-stripping. No extra dependencies (no vitest/jest/ts-node).

## Files

- `memo-grammar.test.ts` — `armMemo`/`cancelMemo`/`parseArmMemo`/`parseCancelMemo`
  builders, round-trips, and the malformed-input rejections (the point of the suite).
- `fixtures-invariants.test.ts` — `liveIdx === seq+1`, rung-hash commitment,
  ladder ordering, deadline derivation, terminal-state schedule drop, and the
  N10 privacy invariant (SwitchView never leaks a capsule).
- `contract-shapes.test.ts` — pinned constants (`LADDER_N`, `FAST_PATH_MAX_BYTES`,
  `DRAND_PERIOD_SEC`), `SERVER_ONLY_SECRETS ⊆ ENV_VARS` with no `NEXT_PUBLIC_*`,
  and the `StorageRef` discriminated-union routing rule.

## `ts-resolve.mjs`

`lib/fixtures.ts` (frozen) imports `./types` **without** a file extension. Node's
native type-stripping runs strict ESM resolution, which rejects extensionless
relative imports (`ERR_MODULE_NOT_FOUND`). Since `lib/**` is a frozen contract we
must not edit, `ts-resolve.mjs` is a minimal module-resolution hook (wired in via
`node --import` in the `test` script) that retries a failed extensionless relative
specifier as `.ts`. It touches nothing else.
