// POST /api/ledger/build-transfer — freeze the device-signable arm/cancel transfer (C1).
//
// Body = { ledgerAccountId, amountHbar, memo }. Returns the frozen (UNSIGNED) transaction
// plus the exact TransactionBody bytes the Ledger must sign. The agent only assembles the
// body here; it adds no signature (payer = the Ledger account). The browser signs the
// returned bodyHex on-device, then calls /api/ledger/submit-transfer.
import { NextResponse } from "next/server";
import { buildLedgerTransfer, hasHederaCreds } from "@/lib/hedera.ts";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!hasHederaCreds()) {
    return NextResponse.json({ error: "agent Hedera credentials are not configured" }, { status: 503 });
  }
  let body: { ledgerAccountId?: unknown; amountHbar?: unknown; amountTinybar?: unknown; memo?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad JSON body" }, { status: 400 });
  }
  const ledgerAccountId = typeof body.ledgerAccountId === "string" ? body.ledgerAccountId.trim() : "";
  const memo = typeof body.memo === "string" ? body.memo : "";
  // Amount accepted as ℏ (arm funding) or exact tinybars (the 1-tinybar cancel).
  let amountTinybar = NaN;
  if (typeof body.amountTinybar === "number") amountTinybar = Math.round(body.amountTinybar);
  else if (typeof body.amountHbar === "number") amountTinybar = Math.round(body.amountHbar * 100_000_000);
  if (!/^\d+\.\d+\.\d+$/.test(ledgerAccountId)) {
    return NextResponse.json({ error: "ledgerAccountId must be a Hedera account id (0.0.x)" }, { status: 400 });
  }
  if (!Number.isFinite(amountTinybar) || amountTinybar <= 0) {
    return NextResponse.json({ error: "a positive amountHbar or amountTinybar is required" }, { status: 400 });
  }
  if (!memo) {
    return NextResponse.json({ error: "memo is required" }, { status: 400 });
  }
  try {
    const built = await buildLedgerTransfer({ ledgerAccountId, amountTinybar, memo });
    return NextResponse.json(built);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
