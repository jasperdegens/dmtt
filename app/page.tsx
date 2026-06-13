// app/page.tsx — the single page. The whole DMTT lifecycle is ONE chat flow (Phase 7):
// setup (MEMO → TERMS → WORLD → SIGN → ARM) and, after arming, the live switch
// (status + countdown + check-in / cancel / reveal) — all in the same interface, with
// no full-page handoff. Opening `/?t=<topicId>` restores this chat with the switch
// loaded and the watcher running (the Chat component owns that, client-side). The
// direct status route stays usable at `/s/[topicId]` for QR / sharing.
//
// PLAINTEXT and K never leave the browser (the MemoCard encrypts locally); this page is
// a server component that only renders the client chat shell below.

import { Chat } from "@/components/Chat.tsx";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Dead Men Tell Tales</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Encrypt a memo, arm it with your Ledger and World ID, check in to stay quiet.
          Go silent and the network releases it.
        </p>
      </header>

      <Chat />
    </main>
  );
}
