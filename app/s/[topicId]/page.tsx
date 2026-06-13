// app/s/[topicId]/page.tsx — the per-switch status + reveal view (WS-F).
//
// Combines the live StatusCard (client-polled GET /api/switch/[topicId]) with the
// RevealCard (the §4 in-browser reveal pipeline). We fetch the PUBLIC SwitchView once
// on the server for the initial reveal state; StatusCard keeps the status fresh
// client-side. Next 15: params is a Promise. Never exposes agent-private capsules —
// only what /api/switch already projects (N10).

import { headers } from "next/headers";

import { StatusCard } from "@/components/StatusCard.tsx";
import { RevealCard } from "@/components/RevealCard.tsx";
import type { SwitchView } from "@/lib/types.ts";

async function loadView(topicId: string): Promise<SwitchView | null> {
  try {
    const h = await headers();
    const host = h.get("host") ?? "localhost:3000";
    const proto = h.get("x-forwarded-proto") ?? "http";
    const res = await fetch(`${proto}://${host}/api/switch/${topicId}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as SwitchView;
  } catch {
    return null;
  }
}

export default async function SwitchPage({
  params,
}: {
  params: Promise<{ topicId: string }>;
}) {
  const { topicId } = await params; // Next 15: params is async.
  const view = await loadView(topicId);

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6 sm:p-8">
      <header className="mb-2">
        <a href="/" className="text-xs text-neutral-500 hover:text-neutral-300">
          ← Dead Men Tell Tales
        </a>
      </header>

      <StatusCard topicId={topicId} />

      {view ? (
        <RevealCard view={view} />
      ) : (
        <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
          <h2 className="text-lg font-semibold">The memo</h2>
          <p className="mt-2 text-sm text-neutral-400">
            No switch found for this topic, or it isn&apos;t reachable yet.
          </p>
        </div>
      )}
    </main>
  );
}
