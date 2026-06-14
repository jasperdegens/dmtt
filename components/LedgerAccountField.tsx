import type { AccountId } from "@/lib/types.ts";

export function LedgerAccountField({ account }: { account: AccountId }) {
  return (
    <div className="ledger-account" aria-label="Connected Ledger account">
      <span className="ledger-account__label">Ledger account</span>
      <code className="ledger-account__value">{account}</code>
    </div>
  );
}
