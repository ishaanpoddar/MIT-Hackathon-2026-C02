import { NextResponse } from "next/server";

let cachedBalance: { sats: number; ts: number } | null = null;
const CACHE_MS = 4000;

export async function GET() {
  const now = Date.now();
  if (cachedBalance && now - cachedBalance.ts < CACHE_MS) {
    return NextResponse.json({ sats: cachedBalance.sats, cached: true });
  }

  try {
    const { execSync } = await import("child_process");
    const result = execSync(`npx @moneydevkit/agent-wallet@latest balance`, {
      encoding: "utf-8",
      timeout: 15000,
    });
    const trimmed = result.trim();

    let sats = 0;
    try {
      const parsed = JSON.parse(trimmed);
      sats =
        parsed.balance_sats ??
        parsed.balance ??
        parsed.sats ??
        parsed.amount_sats ??
        0;
    } catch {
      const match = trimmed.match(/(\d[\d,]*)\s*(?:sats?|SATS?)/);
      if (match) sats = parseInt(match[1].replace(/,/g, ""), 10);
    }

    cachedBalance = { sats, ts: now };
    return NextResponse.json({ sats, raw: trimmed });
  } catch (err) {
    return NextResponse.json(
      { sats: 0, error: String(err), unavailable: true },
      { status: 200 }
    );
  }
}
