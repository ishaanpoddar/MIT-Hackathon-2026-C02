import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "standardwebhooks";

const secret = process.env.MDK_WEBHOOK_SECRET;

export async function POST(req: NextRequest) {
  if (!secret) {
    return NextResponse.json({ error: "webhook_secret_not_configured" }, { status: 500 });
  }

  const body = await req.text();
  const headers = {
    "webhook-id": req.headers.get("webhook-id") ?? "",
    "webhook-timestamp": req.headers.get("webhook-timestamp") ?? "",
    "webhook-signature": req.headers.get("webhook-signature") ?? "",
  };

  const wh = new Webhook(secret);
  let payload: Record<string, unknown>;
  try {
    payload = wh.verify(body, headers) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const { type, data } = payload as { type: string; data: Record<string, unknown> };

  console.log(`💰 [WEBHOOK] type=${type}`, JSON.stringify(data).slice(0, 200));

  switch (type) {
    case "checkout.completed":
      console.log(`✅ [SATS-IN] checkout.completed · received ${data.amountSats} sats`);
      break;
    case "checkout.failed":
      console.error(`❌ [SATS-IN] checkout.failed · ${JSON.stringify(data)}`);
      break;
    case "payment.received":
      console.log(`✅ [SATS-IN] payment.received · ${data.amountSats} sats`);
      break;
  }

  return NextResponse.json({ received: true });
}
