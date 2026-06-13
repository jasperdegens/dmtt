"use client";

// components/AboutButton.tsx — the lower-left "About the project" control.
//
// Replaces the ambient watch in the dock corner with a button that opens the project
// README in a simple in-app markdown viewer (react-markdown + GFM, so the README's
// tables render). The README is fetched once, on first open, from /api/readme.

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function AboutButton() {
  const [open, setOpen] = useState(false);
  const [md, setMd] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Fetch the README the first time the modal opens.
  useEffect(() => {
    if (!open || md !== null || err !== null) return;
    let live = true;
    fetch("/api/readme")
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((t) => live && setMd(t))
      .catch(() => live && setErr("Couldn't haul up the logbook."));
    return () => {
      live = false;
    };
  }, [open, md, err]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button type="button" className="about-btn" onClick={() => setOpen(true)}>
        <span className="about-btn__icon">⚓</span>
        <span className="about-btn__title">About the project</span>
      </button>

      {open ? (
        <div
          className="about-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="About the project"
          onClick={() => setOpen(false)}
        >
          <div className="about-modal" onClick={(e) => e.stopPropagation()}>
            <div className="about-modal__head">
              <h2 className="about-modal__heading">⚓ Dead Men Tell Tales</h2>
              <button
                type="button"
                className="about-modal__close"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="about-modal__body thin-scroll markdown">
              {err ? (
                <p>{err}</p>
              ) : md === null ? (
                <p className="muted">Hauling up the logbook…</p>
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ node: _node, ...props }) => (
                      <a {...props} target="_blank" rel="noreferrer" />
                    ),
                  }}
                >
                  {md}
                </ReactMarkdown>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
