// app/api/file/[fileId]/route.ts — backend FileContentsQuery proxy (CONTRACTS §9).
//
// Streams raw HFS ciphertext bytes (application/octet-stream) for HFS-stored switches:
// the mirror serves no file bytes, so reveal reads them through this proxy. HCS-stored
// ciphertext is reassembled from the mirror directly and never hits this route.
//
// N10-safe: this returns only ENCRYPTED bytes. The plaintext is recovered in-browser
// (tlock → K → AES-GCM); it never re-enters the server. No creds ⇒ 503; a bad/missing
// fileId ⇒ 404 (never leaks the agent's operator state).

import { readFileBytes, hasHederaCreds } from "@/lib/hedera.ts";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  if (!hasHederaCreds()) {
    return new Response("hedera credentials unavailable", { status: 503 });
  }

  const { fileId } = await ctx.params; // Next 15: params is async.

  try {
    const bytes = await readFileBytes(fileId);
    // Uint8Array is a valid BodyInit; copy into a fresh view so the buffer is exact.
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(bytes.length),
      },
    });
  } catch {
    return new Response("file not found", { status: 404 });
  }
}
