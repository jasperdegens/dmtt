// app/page.tsx — the single page. The whole DMTT lifecycle is ONE chat flow (Phase 7):
// setup (MEMO → TERMS → WORLD → SIGN → ARM) and, after arming, the live switch
// (status + countdown + check-in / cancel / reveal) — all in the same interface, with
// no full-page handoff. Phase 8 reframes it as a pirate harbour scene (HomeScene) with
// an animated captain who reacts to the flow; the lifecycle + security model are
// unchanged. Opening `/?t=<topicId>` restores the chat with the switch loaded and the
// watcher running. The direct status route stays usable at `/s/[topicId]` for QR.
//
// PLAINTEXT and K never leave the browser (the MemoCard encrypts locally); this server
// component only renders the client scene below.

import { HomeScene } from "@/components/HomeScene.tsx";

export default function Home() {
  return <HomeScene />;
}
