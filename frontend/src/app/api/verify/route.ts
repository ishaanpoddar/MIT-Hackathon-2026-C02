import { withDeferredSettlement, type SettleResult } from "@moneydevkit/nextjs/server";

const FASTAPI_URL = process.env.FASTAPI_URL || "http://localhost:8001";

const handler = async (req: Request, settle: () => Promise<SettleResult>) => {
  const body = await req.json();
  const { question, ai_draft, domain, request_id, tier, sats_paid } = body;

  console.log(`💰 [L402] /api/verify — settle attempt for request=${request_id} tier=${tier} sats=${sats_paid}`);

  try {
    const settlement = await settle();
    if (!settlement.settled) {
      console.error(`❌ [L402] settlement failed for request=${request_id}`);
      return Response.json({ error: "settlement_failed" }, { status: 500 });
    }
    console.log(`✅ [L402] settled for request=${request_id} preimage=${(settlement.preimage || "").slice(0, 16)}...`);

    const notifyRes = await fetch(`${FASTAPI_URL}/do-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        ai_draft,
        domain,
        request_id,
        tier: tier || "triage",
        sats_paid: sats_paid || 100,
        payment_preimage: settlement.preimage || "",
      }),
    });

    if (!notifyRes.ok) {
      const err = await notifyRes.text();
      return Response.json({ error: "notify_failed", detail: err }, { status: 502 });
    }

    const { request_id: rid } = await notifyRes.json();

    const verdictRes = await fetch(`${FASTAPI_URL}/verdict/${rid}`, {
      headers: { "Content-Type": "application/json" },
    });

    if (!verdictRes.ok) {
      return Response.json({ error: "verdict_timeout" }, { status: 504 });
    }

    const verdict = await verdictRes.json();

    return Response.json({
      status: "verified",
      request_id: rid,
      expert_verdict: verdict.expert_verdict,
      expert_name: verdict.expert_name,
      expert_credentials: verdict.expert_credentials,
      license_attestation: verdict.license_attestation,
      latency_seconds: verdict.latency_seconds,
      signature: verdict.signature,
      public_key: verdict.public_key,
      signed_payload: verdict.signed_payload,
    });
  } catch (err) {
    return Response.json(
      { error: "verification_failed", detail: String(err) },
      { status: 500 }
    );
  }
};

export const POST = withDeferredSettlement(
  { amount: 2, currency: "SAT" },
  handler
);
