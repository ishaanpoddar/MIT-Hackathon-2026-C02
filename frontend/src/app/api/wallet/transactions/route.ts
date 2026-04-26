import { NextResponse } from "next/server";

type Payment = {
  paymentHash: string;
  amountSats: number;
  direction: "inbound" | "outbound";
  timestamp: number;
  status: string;
};

const FASTAPI_URL = process.env.FASTAPI_URL || "http://localhost:8001";

let cache: { payments: Payment[]; ts: number } | null = null;
const CACHE_MS = 3000;

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_MS) {
    return NextResponse.json({ payments: cache.payments, cached: true });
  }

  try {
    const res = await fetch(`${FASTAPI_URL}/wallet/transactions`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { payments: [], error: `backend ${res.status}` },
        { status: 200 }
      );
    }

    const body = (await res.json()) as { payments?: Payment[]; error?: string };
    const payments = body.payments ?? [];

    cache = { payments, ts: now };
    return NextResponse.json({ payments, error: body.error });
  } catch (err) {
    return NextResponse.json(
      { payments: [], error: String(err) },
      { status: 200 }
    );
  }
}
