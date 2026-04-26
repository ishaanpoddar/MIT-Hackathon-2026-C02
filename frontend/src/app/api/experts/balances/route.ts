import { NextResponse } from "next/server";

type ExpertSummary = {
  id: string;
  name: string;
  specialty: string;
  license_attestation: string;
  total_sats_earned: number;
  verification_count: number;
};

let cache: { experts: ExpertSummary[]; ts: number } | null = null;
const CACHE_MS = 5000;

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_MS) {
    return NextResponse.json({ experts: cache.experts, cached: true });
  }

  const base = process.env.FASTAPI_URL || "http://localhost:8001";
  const url = `${base}/transactions-summary`;

  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { experts: [], error: `Backend responded with ${res.status}` },
        { status: 200 }
      );
    }

    const body = await res.json();
    const experts: ExpertSummary[] = body?.experts ?? [];
    cache = { experts, ts: now };
    return NextResponse.json({ experts });
  } catch (err) {
    return NextResponse.json(
      { experts: [], error: String(err) },
      { status: 200 }
    );
  }
}
