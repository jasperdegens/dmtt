"use client";

// components/HomeScene.tsx — the home stage (Phase 8). Composes the stormy harbour
// scene, the salty captain, and the functional chat dock into one full-bleed view.
//
// Layout: a fixed left DOCK (hero → chat bubble → countdown watch) over the scene; the
// captain anchored lower-right; the foreground wave riding in front of the lower scene.
// PirateProvider wires the captain's state to the chat flow + cards. The actual DMTT
// lifecycle (encrypt → terms → World → Ledger → arm → live switch) is unchanged — this
// only reframes it; plaintext still never leaves the browser (the MemoCard encrypts
// locally, the chat input is disabled on the memo step).

import { useEffect } from "react";

import { Chat } from "./Chat.tsx";
import { PirateProvider } from "./scene/PirateContext.tsx";
import { SceneBackground } from "./scene/SceneBackground.tsx";
import { WavesForeground } from "./scene/WavesForeground.tsx";
import { PirateStage } from "./scene/PirateStage.tsx";
import { Watch } from "./scene/Watch.tsx";

export function HomeScene() {
  // Lock page scroll while the fixed scene is mounted (panels scroll internally).
  useEffect(() => {
    document.body.classList.add("scene-locked");
    return () => document.body.classList.remove("scene-locked");
  }, []);

  return (
    <PirateProvider>
      <SceneBackground />

      <div className="dock">
        <header className="dock__top hero">
          <p className="hero__eyebrow">Heed the Keeper of the Pact</p>
          <h1 className="hero__title">
            <span>Dead Men</span>
            <em>Tell Tales</em>
          </h1>
          <p className="hero__sub">
            Leave your final words with the old sea dog — encrypted in your browser,
            delivered only if you fall silent upon the tides.
          </p>
        </header>

        <div className="chat-shell">
          <Chat />
        </div>

        <div className="dock__bottom">
          <Watch />
        </div>
      </div>

      <PirateStage />
      <WavesForeground />
    </PirateProvider>
  );
}
