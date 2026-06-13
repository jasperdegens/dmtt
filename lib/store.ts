// lib/store.ts — WS-C: the SwitchStore over data/switches/{topicId}.json.
//
// The store is the agent's private state cache (CONTRACTS §6). It holds the full
// Switch — including the agent-held, un-fired ladder capsules (N10) — so it is
// gitignored and never served raw. Public callers get toSwitchView() instead.
//
// Three guarantees the executors depend on (CONTRACTS §6):
//  • save is ATOMIC: write a temp file → fsync → rename over the target. A crash
//    mid-write never leaves a half-written / corrupt switch on disk.
//  • withLock serializes read-modify-write per topicId (a promise-chain mutex), so
//    the create-schedule-before-delete ordering and the liveIdx/seq invariant hold
//    under concurrency ("20 concurrent writes don't corrupt").
//  • toSwitchView is the PUBLIC projection — NEVER any ladder[].capsuleB64 (N10).

import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  open,
} from "node:fs/promises";
import { join } from "node:path";

import type {
  Switch,
  SwitchView,
  SwitchEvent,
  SwitchStore,
  StoreMutator,
  TopicId,
} from "./types.ts";

const FILE_EXT = ".json";

function isENOENT(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "ENOENT"
  );
}

/** Builds a SwitchStore rooted at `dir` (default data/switches). */
export function createStore(dir: string = "data/switches"): SwitchStore {
  // Per-topicId promise chain. Each withLock appends to the tail so callers on the
  // same topic run strictly one-at-a-time; different topics never block each other.
  const chains = new Map<TopicId, Promise<unknown>>();

  function pathFor(topicId: TopicId): string {
    return join(dir, topicId + FILE_EXT);
  }

  async function load(topicId: TopicId): Promise<Switch | null> {
    try {
      const raw = await readFile(pathFor(topicId), "utf8");
      return JSON.parse(raw) as Switch;
    } catch (err) {
      if (isENOENT(err)) return null;
      throw err;
    }
  }

  async function save(sw: Switch): Promise<void> {
    await mkdir(dir, { recursive: true });
    const target = pathFor(sw.topicId);
    const rand = Math.random().toString(36).slice(2) + "-" + process.pid;
    const tmp = `${target}.tmp-${rand}`;
    const data = JSON.stringify(sw, null, 2);
    // Write the bytes, fsync to durably flush, then atomically rename over target.
    const fh = await open(tmp, "w");
    try {
      await fh.writeFile(data, "utf8");
      await fh.sync();
    } finally {
      await fh.close();
    }
    try {
      await rename(tmp, target);
    } catch (err) {
      // Clean up the temp file on a failed rename so no .tmp turds linger.
      await unlink(tmp).catch(() => {});
      throw err;
    }
  }

  async function removeFile(topicId: TopicId): Promise<void> {
    try {
      await unlink(pathFor(topicId));
    } catch (err) {
      if (!isENOENT(err)) throw err; // already gone is fine
    }
  }

  async function list(): Promise<TopicId[]> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (err) {
      if (isENOENT(err)) return []; // dir not created yet
      throw err;
    }
    return names
      .filter((n) => n.endsWith(FILE_EXT))
      .map((n) => n.slice(0, -FILE_EXT.length));
  }

  function withLock<T>(topicId: TopicId, mutator: StoreMutator<T>): Promise<T> {
    const prior = chains.get(topicId) ?? Promise.resolve();
    // Chain the critical section after whatever is already queued for this topic.
    const run = prior.then(async () => {
      const current = await load(topicId);
      const { next, result } = await mutator(current);
      if (next === null) {
        await removeFile(topicId);
      } else {
        await save(next);
      }
      return result;
    });
    // Keep the chain alive even if this op rejects, so the next caller still runs.
    chains.set(
      topicId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  return { load, save, list, withLock };
}

/** The process-wide store (production wiring). */
export const store: SwitchStore = createStore();

/** PUBLIC projection of a Switch (CONTRACTS §9). NEVER includes any capsuleB64 —
 *  the un-fired ladder capsules are agent-held until release (N10). Public callers
 *  see only the rung hashes plus the mirror-read audit trail. */
export function toSwitchView(sw: Switch, events: SwitchEvent[]): SwitchView {
  return {
    topicId: sw.topicId,
    status: sw.status,
    policyHash: sw.policyHash,
    terms: sw.policy.terms,
    storage: sw.storage,
    armTime: sw.armTime,
    liveIdx: sw.liveIdx,
    seq: sw.seq,
    currentDeadline: sw.status === "ACTIVE" ? sw.currentDeadline : null,
    rungHashes: sw.ladder.map((r) => r.hash),
    events,
  };
}
