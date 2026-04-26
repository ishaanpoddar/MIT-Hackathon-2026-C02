import { withDeferredSettlement, type SettleResult } from "@moneydevkit/nextjs/server";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const TRIAGE_MODEL = "gpt-4o-mini";

const TRIAGE_SYSTEM_PROMPT =
  'You are a triage agent for an AI-to-expert verification marketplace. You evaluate whether an AI\'s draft answer is good enough to ship directly to a user, or whether it needs review by a licensed human expert. Be conservative — when in doubt about high-stakes content (medical, legal, financial), recommend escalation. Return ONLY valid JSON: {"escalate": boolean, "reason": "1 sentence why", "confidence": 0.0-1.0}.';

type TriageBody = {
  question: string;
  ai_draft: string;
  domain: string;
};

type TriageVerdict = {
  escalate: boolean;
  reason: string;
  confidence: number;
};

const FAILSAFE_VERDICT: TriageVerdict = {
  escalate: true,
  reason: "Triage unavailable, defaulting to escalation",
  confidence: 0.5,
};

const truncate = (s: string, n: number): string =>
  s.length > n ? `${s.slice(0, n)}...` : s;

const extractPreimage = (req: Request): string => {
  const auth = req.headers.get("authorization") || "";
  const match = auth.match(/(?:L402|LSAT)\s+\S+:(\S+)/i);
  return match ? match[1] : "";
};

const parseVerdict = (raw: string): TriageVerdict => {
  try {
    const parsed = JSON.parse(raw) as Partial<TriageVerdict>;
    if (
      typeof parsed.escalate !== "boolean" ||
      typeof parsed.reason !== "string" ||
      typeof parsed.confidence !== "number"
    ) {
      return FAILSAFE_VERDICT;
    }
    const confidence = Math.max(0, Math.min(1, parsed.confidence));
    return {
      escalate: parsed.escalate,
      reason: parsed.reason,
      confidence,
    };
  } catch {
    return FAILSAFE_VERDICT;
  }
};

const handler = async (req: Request, settle: () => Promise<SettleResult>) => {
  let body: TriageBody;
  try {
    body = (await req.json()) as TriageBody;
  } catch (err) {
    console.error(`❌ [TRIAGE] error: invalid_json ${String(err)}`);
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const { question, ai_draft, domain } = body;

  if (
    typeof question !== "string" ||
    typeof ai_draft !== "string" ||
    typeof domain !== "string"
  ) {
    console.error(`❌ [TRIAGE] error: missing_fields`);
    return Response.json({ error: "missing_fields" }, { status: 400 });
  }

  console.log(
    `🤖 [TRIAGE] request domain=${domain} question=${truncate(question, 80)}`
  );

  let verdict: TriageVerdict = FAILSAFE_VERDICT;
  let llmFailed = false;

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY not set");
    }

    const userPrompt = `Domain: ${domain}\nQuestion: ${question}\nAI's draft answer: ${ai_draft}\n\nShould this be escalated to a licensed human expert? Return JSON.`;

    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: TRIAGE_MODEL,
        messages: [
          { role: "system", content: TRIAGE_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 200,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    verdict = parseVerdict(content);
  } catch (err) {
    llmFailed = true;
    console.error(`❌ [TRIAGE] error: ${String(err)}`);
    verdict = FAILSAFE_VERDICT;
  }

  if (!llmFailed) {
    console.log(
      `🤖 [TRIAGE] LLM verdict: escalate=${verdict.escalate} reason=${truncate(verdict.reason, 120)}`
    );
  }

  let settlement: SettleResult;
  try {
    settlement = await settle();
  } catch (err) {
    console.error(`❌ [TRIAGE] error: settle_threw ${String(err)}`);
    return Response.json({ error: "settlement_failed" }, { status: 500 });
  }

  if (!settlement.settled) {
    console.error(`❌ [TRIAGE] error: settlement not settled`);
    return Response.json({ error: "settlement_failed" }, { status: 500 });
  }

  const preimage = extractPreimage(req);
  console.log(`💰 [TRIAGE-L402] settled preimage=${preimage.slice(0, 16)}...`);

  return Response.json({
    escalate: verdict.escalate,
    reason: verdict.reason,
    confidence: verdict.confidence,
    model: TRIAGE_MODEL,
    preimage,
  });
};

export const POST = withDeferredSettlement(
  { amount: 1, currency: "SAT" },
  handler
);
