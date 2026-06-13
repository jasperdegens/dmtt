"use client";

// components/SwitchScene.tsx — the per-switch status + reveal view (Phase 8), framed in
// the same pirate harbour as the home scene.
//
// Reuses every functional card unchanged (StatusCard self-polls; CheckinCard / SwitchActions
// act on the server-loaded view and reload on success; RevealCard runs the in-browser
// reveal pipeline). The captain rests idle here and hauls the chest open during a reveal.
// Direct route stays usable for QR / sharing; "Open in chat" hands back to the full flow.

import { StatusCard } from "./StatusCard.tsx";
import { RevealCard } from "./RevealCard.tsx";
import { CheckinCard } from "./CheckinCard.tsx";
import { SwitchActions } from "./SwitchActions.tsx";
import { PirateProvider } from "./scene/PirateContext.tsx";
import { SceneBackground } from "./scene/SceneBackground.tsx";
import { WavesForeground } from "./scene/WavesForeground.tsx";
import { PirateStage } from "./scene/PirateStage.tsx";
import type { SwitchView } from "@/lib/types.ts";

export function SwitchScene({
  topicId,
  initialView,
}: {
  topicId: string;
  initialView: SwitchView | null;
}) {
  return (
    <PirateProvider>
      <SceneBackground />

      <main className="switch-page">
        <header className="switch-head">
          <a href="/" className="switch-head__brand">
            ⚓ Dead Men Tell Tales
          </a>
          <a href={`/?t=${topicId}`} className="gold-link text-xs">
            Open in chat →
          </a>
        </header>

        <StatusCard topicId={topicId} />

        {/* The owner's affordances — ACTIVE-only. The initial server-loaded view is
            enough — a successful action reloads, and StatusCard keeps status fresh. */}
        {initialView && initialView.status === "ACTIVE" ? (
          <>
            <CheckinCard view={initialView} />
            <SwitchActions view={initialView} />
          </>
        ) : null}

        {initialView ? (
          <RevealCard view={initialView} />
        ) : (
          <div className="panel p-5">
            <h2 className="panel-title">The memo</h2>
            <p className="panel-note mt-2 text-sm">
              No switch found for this topic, or it isn&apos;t reachable yet.
            </p>
          </div>
        )}
      </main>

      <PirateStage />
      <WavesForeground />
    </PirateProvider>
  );
}
