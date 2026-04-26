import { NextResponse } from "next/server";

const FASTAPI_URL = process.env.FASTAPI_URL || "http://localhost:8001";

let cachedBalance: { sats: number; ts: number } | null = null;
const CACHE_MS = 4000;

export async function GET() {
  const now = Date.now();
  if (cachedBalance && now - cachedBalance.ts < CACHE_MS) {
    return NextResponse.json({ sats: cachedBalance.sats, cached: true });
  }

  try {
    const res = await fetch(`${FASTAPI_URL}/wallet/balance`, {
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { sats: 0, error: `backend ${res.status}`, unavailable: true },
        { status: 200 }
      );
    }

    const data = (await res.json()) as {
      available: boolean;
      sats?: number;
      error?: string;
    };

    if (!data.available) {
      return NextResponse.json(
        {
          sats: 0,
          error: data.error || "wallet unavailable",
          unavailable: true,
        },
        { status: 200 }
      );
    }

    const sats = data.sats ?? 0;
    cachedBalance = { sats, ts: now };
    return NextResponse.json({ sats });
  } catch (err) {
    return NextResponse.json(
      { sats: 0, error: String(err), unavailable: true },
      { status: 200 }
    );
  }
}
