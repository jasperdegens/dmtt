// components/WorldIcon.tsx — the shared World ID globe glyph.
//
// Used wherever a human-verification action lives: the World gate button (arm-enroll /
// check-in) AND the live "Check in" affordance, since a check-in is authorized by the
// World nullifier (CLAUDE.md N10). Strokes in currentColor so it inherits the button's
// text colour; sized via the .world-icon class.

export function WorldIcon({ className = "world-icon" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="8.25" />
      <path d="M3.75 12h16.5" />
      <path d="M12 3.75c2.35 2.2 3.55 4.95 3.55 8.25S14.35 18.05 12 20.25" />
      <path d="M12 3.75C9.65 5.95 8.45 8.7 8.45 12s1.2 6.05 3.55 8.25" />
    </svg>
  );
}
