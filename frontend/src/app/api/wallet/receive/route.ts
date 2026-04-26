import { NextResponse } from "next/server";

const FASTAPI_URL = process.env.FASTAPI_URL || "http://localhost:8001";

export async function POST() {
  try {
    const res = await fetch(`${FASTAPI_URL}/wallet/receive-bolt12`, {
      method: "POST",
      cache: "no-store",
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `backend ${res.status}: ${detail.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const data = (await res.json()) as { offer?: string; bolt12?: string };
    const offer = data.offer ?? data.bolt12 ?? "";

    if (!offer) {
      return NextResponse.json(
        { error: "Backend returned no offer", raw: data },
        { status: 502 }
      );
    }

    return NextResponse.json({ offer });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
