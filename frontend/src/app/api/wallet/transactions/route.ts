import { NextResponse } from "next/server";

type Payment = {
  paymentHash: string;
  amountSats: number;
  direction: "inbound" | "outbound";
  timestamp: number;
  status: string;
};

let cache: { payments: Payment[]; ts: number } | null = null;
const CACHE_MS = 3000;
const MDK_URL = "http://localhost:3456/payments";

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_MS) {
    return NextResponse.json({ payments: cache.payments, cached: true });
  }

  try {
    const res = await fetch(MDK_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { payments: [], error: `MDK responded with ${res.status}` },
        { status: 200 }
      );
    }

    const body = await res.json();
    const payments: Payment[] =
      body?.data?.payments ?? body?.payments ?? [];

    cache = { payments, ts: now };
    return NextResponse.json({ payments });
  } catch (err) {
    return NextResponse.json(
      { payments: [], error: String(err) },
      { status: 200 }
    );
  }
}
