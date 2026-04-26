import { NextRequest } from "next/server";

const FASTAPI_URL = process.env.FASTAPI_URL || "http://localhost:8001";
const SKIP_LIGHTNING = process.env.SKIP_LIGHTNING === "true";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";

export async function POST(req: NextRequest) {
  const { message, session_id } = await req.json();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const upstream = await fetch(`${FASTAPI_URL}/process-stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: message, session_id }),
        });

        if (!upstream.ok || !upstream.body) {
          send({ step: "error", message: "Backend unavailable" });
          controller.close();
          return;
        }

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let verifyCtx:
          | {
              draft: string;
              domain: string;
              subspecialty: string;
              request_id: string;
              sats: number;
              price_dollars: number;
              tier: string;
            }
          | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() || "";

          for (const block of blocks) {
            if (!block.startsWith("data: ")) continue;
            const json = block.slice(6).trim();
            if (!json) continue;

            controller.enqueue(encoder.encode(`data: ${json}\n\n`));

            try {
              const evt = JSON.parse(json);
              if (evt.step === "needs_verification") {
                verifyCtx = {
                  draft: evt.draft,
                  domain: evt.domain,
                  subspecialty: evt.subspecialty || "",
                  request_id: evt.request_id,
                  sats: evt.sats,
                  price_dollars: evt.price_dollars,
                  tier: evt.tier,
                };
              }
            } catch {}
          }
        }

        if (!verifyCtx) {
          controller.close();
          return;
        }

        // === AGENT-TO-AGENT: triage agent consultation (1 sat) ===
        send({ step: "triage_paying", sats: 1, price_dollars: 0.01 });

        let triageVerdict: { escalate: boolean; reason: string; confidence: number; preimage?: string } = {
          escalate: true,
          reason: "Triage skipped",
          confidence: 0.5,
        };

        try {
          if (SKIP_LIGHTNING) {
            // Dev mode: skip the L402 dance, assume triage says escalate
            triageVerdict = {
              escalate: true,
              reason: "Triage simulated (SKIP_LIGHTNING dev mode)",
              confidence: 0.7,
              preimage: "DEV_SKIP_LIGHTNING",
            };
            send({ step: "payment_settled", preimage: "DEV_SKIP_LIGHTNING", sats: 1 });
          } else {
            const triageRes = await callPaidEndpoint(
              `${APP_URL}/api/triage`,
              { question: message, ai_draft: verifyCtx.draft, domain: verifyCtx.domain },
              (p) => {
                send({ step: "payment_settled", preimage: p, sats: 1 });
              }
            );
            if (triageRes.ok) {
              const data = await triageRes.json();
              triageVerdict = {
                escalate: data.escalate ?? true,
                reason: data.reason ?? "",
                confidence: data.confidence ?? 0.5,
                preimage: data.preimage,
              };
            }
          }
        } catch (err) {
          console.error("[TRIAGE] failed, defaulting to escalate:", err);
        }

        send({
          step: "triage_complete",
          escalate: triageVerdict.escalate,
          reason: triageVerdict.reason,
          confidence: triageVerdict.confidence,
        });

        if (!triageVerdict.escalate) {
          // Triage said no escalation — return AI draft as direct answer
          send({
            step: "triage_no_escalation",
            message: "Triage agent confirmed AI draft is sufficient — no human verification needed.",
          });
          send({
            step: "answer",
            answer: verifyCtx.draft,
            type: "direct",
          });
          controller.close();
          return;
        }

        send({ step: "paying", sats: verifyCtx.sats, price_dollars: verifyCtx.price_dollars });

        let preimage = "";
        let verifyData: Record<string, unknown> | null = null;

        if (SKIP_LIGHTNING) {
          const notifyRes = await fetch(`${FASTAPI_URL}/do-verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              question: message,
              ai_draft: verifyCtx.draft,
              domain: verifyCtx.domain,
              subspecialty: verifyCtx.subspecialty,
              request_id: verifyCtx.request_id,
              tier: verifyCtx.tier,
              sats_paid: verifyCtx.sats,
              payment_preimage: "DEV_SKIP_LIGHTNING",
            }),
          });

          if (!notifyRes.ok) {
            send({ step: "verified_fallback", draft: verifyCtx.draft });
            controller.close();
            return;
          }

          send({ step: "verifier_notified" });

          const verdictRes = await fetch(
            `${FASTAPI_URL}/verdict/${verifyCtx.request_id}`,
            { headers: { "Content-Type": "application/json" } }
          );
          if (!verdictRes.ok) {
            send({ step: "verified_fallback", draft: verifyCtx.draft });
            controller.close();
            return;
          }
          verifyData = await verdictRes.json();
        } else {
          try {
            const result = await callPaidEndpoint(
              `${APP_URL}/api/verify`,
              {
                question: message,
                ai_draft: verifyCtx.draft,
                domain: verifyCtx.domain,
                subspecialty: verifyCtx.subspecialty,
                request_id: verifyCtx.request_id,
                tier: verifyCtx.tier,
                sats_paid: verifyCtx.sats,
              },
              (p) => {
                preimage = p;
                send({ step: "payment_settled", preimage: p, sats: verifyCtx!.sats });
                send({ step: "verifier_notified" });
              }
            );

            if (!result.ok) {
              send({ step: "verified_fallback", draft: verifyCtx.draft });
              controller.close();
              return;
            }

            verifyData = await result.json();
          } catch (e) {
            send({
              step: "verified_fallback",
              draft: verifyCtx.draft,
              error: String(e),
            });
            controller.close();
            return;
          }
        }

        send({
          step: "verified",
          answer: verifyCtx.draft,
          expert_verdict: verifyData?.expert_verdict ?? "",
          expert_name: verifyData?.expert_name ?? "",
          expert_credentials: verifyData?.expert_credentials ?? "",
          license_attestation: verifyData?.license_attestation ?? "",
          request_id: verifyCtx.request_id,
          latency_seconds: verifyData?.latency_seconds ?? 0,
          signature: verifyData?.signature ?? "",
          public_key: verifyData?.public_key ?? "",
          signed_payload: verifyData?.signed_payload ?? {},
          domain: verifyCtx.domain,
          tier: verifyCtx.tier,
          sats_paid: verifyCtx.sats,
          price_dollars: verifyCtx.price_dollars,
        });
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ step: "error", message: String(err) })}\n\n`
          )
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

async function callPaidEndpoint(
  url: string,
  body: Record<string, unknown>,
  onPaid: (preimage: string) => void
): Promise<Response> {
  console.log(`⚡ [L402] requesting paid endpoint ${url}`);
  const challenge = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (challenge.status !== 402) {
    console.log(`⚡ [L402] no challenge (status=${challenge.status}) — endpoint returned directly`);
    return challenge;
  }

  const { macaroon, invoice } = await challenge.json();
  console.log(`⚡ [L402] got 402 challenge — invoice=${(invoice || "").slice(0, 30)}...`);
  console.log(`💸 [SATS-OUT] paying L402 invoice via agent wallet...`);

  let preimage: string;
  try {
    preimage = await payInvoice(invoice);
    console.log(`✅ [SATS-OUT] L402 paid · preimage=${preimage.slice(0, 16)}...`);
  } catch (err) {
    console.error(`❌ [SATS-OUT] L402 payment FAILED:`, err);
    throw err;
  }

  onPaid(preimage);

  console.log(`⚡ [L402] re-sending request with preimage to ${url}`);
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `L402 ${macaroon}:${preimage}`,
    },
    body: JSON.stringify(body),
  });
}

async function payInvoice(invoice: string): Promise<string> {
  const { execSync } = await import("child_process");
  const result = execSync(
    `npx @moneydevkit/agent-wallet@latest send ${invoice}`,
    { encoding: "utf-8", timeout: 60000 }
  );
  const data = JSON.parse(result.trim());
  if (!data.preimage) {
    throw new Error(`MDK send returned no preimage: ${result.trim()}`);
  }
  return data.preimage;
}
