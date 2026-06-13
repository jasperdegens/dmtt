// app/s/[topicId]/page.tsx — the per-switch status + reveal view (WS-F), reframed in
// the pirate scene (Phase 8) via the client SwitchScene wrapper.
//
// We fetch the PUBLIC SwitchView once on the server for the initial reveal/action state;
// StatusCard keeps the status fresh client-side. Next 15: params is a Promise. Never
// exposes agent-private capsules — only what /api/switch already projects (N10).

import { headers } from "next/headers";

import { SwitchScene } from "@/components/SwitchScene.tsx";
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

  return <SwitchScene topicId={topicId} initialView={view} />;
}
