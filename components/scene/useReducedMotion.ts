"use client";

// Shared "prefers-reduced-motion" hook. Starts false (SSR-safe), then reflects the
// media query after mount so scene/captain components can swap moving video for a
// static poster. Listens for changes so toggling the OS setting updates live.

import { useEffect, useState } from "react";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
