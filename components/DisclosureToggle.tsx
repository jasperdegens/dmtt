export function DisclosureToggle({
  open,
  closedLabel,
  openLabel,
  onToggle,
}: {
  open: boolean;
  closedLabel: string;
  openLabel: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="disclosure"
      onClick={onToggle}
      aria-expanded={open}
    >
      {open ? `▾ ${openLabel}` : `▸ ${closedLabel}`}
    </button>
  );
}
