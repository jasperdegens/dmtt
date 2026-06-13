// app/api/readme/route.ts — serve the project README as raw markdown for the in-app
// "About the project" viewer. Read-only; no secrets. Served from the repo root on disk.

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function GET(): Promise<Response> {
  try {
    const text = await readFile(join(process.cwd(), "README.md"), "utf8");
    return new NextResponse(text, {
      headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "README not found" }, { status: 404 });
  }
}
