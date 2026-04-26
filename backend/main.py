import os
import uuid
import json
import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase_client import supabase
from llm import generate_draft, detect_stakes
from telegram_bot import init_bot, send_verification_request
from signing import ensure_keypair, build_payload, sign_payload

load_dotenv()

PORT = int(os.environ.get("PORT", "8001"))
DEMO_MODE = os.environ.get("DEMO_MODE", "true").lower() == "true"
DEMO_TIER_SATS = 2
DEMO_TIER_DOLLARS = 0.02

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_bot()
    yield


app = FastAPI(lifespan=lifespan, title="Vouch Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


SIMULATED_EXPERTS = {
    "healthcare": {
        "name": "Dr. Sarah Chen",
        "credentials": "MD Internal Medicine, Stanford 2014 · Board-Certified · 9 yrs experience",
    },
    "legal": {
        "name": "Atty. Marcus Johnson",
        "credentials": "JD Harvard Law 2009 · Admitted NY & CA Bars · 12 yrs experience",
    },
    "finance": {
        "name": "Jennifer Park, CPA",
        "credentials": "CPA, CFA · Wharton 2011 · 10 yrs experience",
    },
    "general": {
        "name": "Expert Panel",
        "credentials": "Multi-domain verification",
    },
}

DOMAIN_LABELS = {
    "healthcare": "medical",
    "legal": "legal",
    "finance": "financial",
    "general": "general",
}


class ProcessRequest(BaseModel):
    question: str
    session_id: str = "demo"


class DoVerifyRequest(BaseModel):
    question: str
    ai_draft: str
    domain: str = "general"
    request_id: str = ""
    tier: str = "triage"
    sats_paid: int = DEMO_TIER_SATS
    payment_preimage: str = ""


class DoVerifyResponse(BaseModel):
    request_id: str


class VerdictResponse(BaseModel):
    request_id: str
    expert_verdict: str
    expert_name: str
    expert_credentials: str
    license_attestation: str
    latency_seconds: float
    signature: str = ""
    public_key: str = ""
    signed_payload: dict = {}


def _sse(event: dict) -> bytes:
    return f"data: {json.dumps(event)}\n\n".encode("utf-8")


@app.post("/process-stream")
async def process_stream(req: ProcessRequest):
    """Stream the agent's reasoning + draft as SSE events."""

    async def generate():
        yield _sse({"step": "thinking", "message": "Analyzing question..."})
        await asyncio.sleep(0.4)

        stakes = await detect_stakes(req.question)
        domain_label = DOMAIN_LABELS.get(stakes.domain, stakes.domain)

        yield _sse({
            "step": "classify",
            "domain": stakes.domain,
            "domain_label": domain_label,
            "stakes_level": "high" if stakes.needs_verification else "low",
        })
        await asyncio.sleep(0.3)

        yield _sse({
            "step": "confidence",
            "value": stakes.confidence,
            "reasoning": stakes.reasoning,
        })
        await asyncio.sleep(0.3)

        if not stakes.needs_verification:
            yield _sse({"step": "no_escalation", "message": f"High confidence ({int(stakes.confidence*100)}%) — answering directly, $0 spent."})
            await asyncio.sleep(0.2)

            yield _sse({"step": "drafting", "message": "Composing answer..."})
            draft = await generate_draft(req.question)
            yield _sse({
                "step": "answer",
                "answer": draft.draft,
                "type": "direct",
            })
            return

        yield _sse({
            "step": "tier_eval",
            "options": [
                {"tier": "triage", "label": "Triage tier", "price_dollars": 0.02, "sats": 2, "description": "Licensed practitioner — confirmation review"},
                {"tier": "senior", "label": "Senior tier", "price_dollars": 0.10, "sats": 10, "description": "Board-certified specialist — depth review"},
                {"tier": "specialist", "label": "Specialist tier", "price_dollars": 0.20, "sats": 20, "description": "Sub-specialty consultation — complex edge cases"},
            ],
        })
        await asyncio.sleep(0.5)

        yield _sse({
            "step": "tier_selected",
            "tier": "triage",
            "price_dollars": DEMO_TIER_DOLLARS,
            "sats": DEMO_TIER_SATS,
            "reason": f"Stakes: high · confidence: {int(stakes.confidence*100)}% — escalating to licensed {domain_label} expert.",
        })
        await asyncio.sleep(0.4)

        yield _sse({"step": "drafting", "message": "Drafting answer for expert review..."})
        draft = await generate_draft(req.question)

        request_id = uuid.uuid4().hex[:8]
        yield _sse({
            "step": "needs_verification",
            "draft": draft.draft,
            "domain": stakes.domain,
            "domain_label": domain_label,
            "request_id": request_id,
            "sats": DEMO_TIER_SATS,
            "price_dollars": DEMO_TIER_DOLLARS,
            "tier": "triage",
        })

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/do-verify", response_model=DoVerifyResponse)
async def do_verify(req: DoVerifyRequest):
    request_id = req.request_id or uuid.uuid4().hex[:8]

    preimage_short = (req.payment_preimage or "(none)")[:16]
    logger.info(
        f"💰 [L402-SETTLED] request={request_id} | tier={req.tier} | "
        f"sats_paid={req.sats_paid} | preimage={preimage_short}..."
    )

    base_row = {
        "id": request_id,
        "question": req.question,
        "ai_draft": req.ai_draft,
        "domain": req.domain,
        "status": "pending",
    }
    extra_row = {
        "tier": req.tier,
        "sats_paid": req.sats_paid,
        "payment_preimage": req.payment_preimage,
    }
    try:
        supabase.table("verification_requests").upsert({**base_row, **extra_row}).execute()
    except Exception as e:
        logger.warning(f"upsert with extra columns failed ({e}); falling back to base schema")
        supabase.table("verification_requests").upsert(base_row).execute()
        try:
            supabase.table("verification_requests").update(extra_row).eq("id", request_id).execute()
        except Exception as e2:
            logger.warning(f"update for extra columns failed ({e2}); migration 003 not applied")

    notified = await send_verification_request(
        request_id=request_id,
        question=req.question,
        ai_draft=req.ai_draft,
        domain=req.domain,
    )

    if not notified and DEMO_MODE:
        asyncio.create_task(simulate_expert_response(request_id, req.domain))
        logger.info(f"Demo mode: simulating expert response for {request_id}")
    elif not notified:
        logger.warning(f"No experts notified for request {request_id}, but request stored for manual claim")

    return DoVerifyResponse(request_id=request_id)


FALLBACK_VERDICTS = {
    "healthcare": "Based on what you've described, I'd recommend evaluation by your primary care provider. Monitor for any worsening symptoms and seek urgent care if anything changes significantly.",
    "legal": "Your situation depends on jurisdiction and specifics. Document everything in writing today and consult a local attorney with subject-matter experience before taking any action.",
    "finance": "This decision depends on your full financial picture. Consider lower-cost alternatives first and consult a fee-only fiduciary advisor before committing.",
    "general": "I've reviewed the AI's response and the key points hold up. For decisions specific to your situation, a qualified professional in this area is worth a follow-up.",
}


async def simulate_expert_response(request_id: str, domain: str):
    await asyncio.sleep(8)

    # Atomic claim: only proceed if status is still 'pending'. Postgres ensures
    # only one concurrent simulator wins this update. Prevents double-payout.
    claim = (
        supabase.table("verification_requests")
        .update({"status": "claimed"})
        .eq("id", request_id)
        .eq("status", "pending")
        .execute()
    )
    if not claim.data:
        logger.warning(
            f"⏭️  [DEDUP] simulate_expert_response skipped for request={request_id} — "
            f"already claimed/resolved by another task"
        )
        return

    # Fetch the original question + draft so we can generate a contextual verdict
    req_row = (
        supabase.table("verification_requests")
        .select("question, ai_draft")
        .eq("id", request_id)
        .execute()
    )
    question = req_row.data[0]["question"] if req_row.data else ""
    ai_draft = req_row.data[0]["ai_draft"] if req_row.data else ""

    result = supabase.table("experts").select("id, name, lightning_address").eq("specialty", domain).eq("available", True).execute()
    expert_row = result.data[0] if result.data else None
    expert_id = expert_row["id"] if expert_row else None

    # Generate dynamic verdict via expert-persona LLM + optional Tavily fact-check
    expert_verdict_text = FALLBACK_VERDICTS.get(domain, FALLBACK_VERDICTS["general"])
    sources_for_receipt: list = []
    fact_check_used = False

    try:
        from tavily import tavily_fact_check
        from llm import generate_expert_verdict

        fact_check = None
        try:
            fact_check = await tavily_fact_check(question, ai_draft)
            if fact_check:
                logger.info(f"🔎 [TAVILY] {len(fact_check.get('sources', []))} sources retrieved for request={request_id}")
        except Exception as e:
            logger.warning(f"⚠️ [TAVILY] fact-check failed for request={request_id}: {e}")

        verdict_obj = await generate_expert_verdict(
            question=question,
            ai_draft=ai_draft,
            domain=domain,
            fact_check=fact_check,
        )
        expert_verdict_text = verdict_obj.verdict or expert_verdict_text
        sources_for_receipt = verdict_obj.sources
        fact_check_used = verdict_obj.fact_check_used
        logger.info(
            f"🩺 [VERDICT] dynamic verdict generated for request={request_id} | "
            f"len={len(expert_verdict_text)} chars | tavily={fact_check_used} | sources={len(sources_for_receipt)}"
        )
    except Exception as e:
        logger.warning(f"⚠️ [VERDICT] dynamic generation failed, using fallback for request={request_id}: {e}")

    update = {
        "status": "resolved",
        "expert_id": expert_id,
        "expert_verdict": expert_verdict_text,
    }
    supabase.table("verification_requests").update(update).eq("id", request_id).execute()
    logger.info(f"🩺 [VERDICT] saved for request={request_id} expert={expert_row.get('name') if expert_row else 'unknown'}")

    if expert_row and expert_row.get("lightning_address"):
        from payouts import pay_expert
        logger.info(f"💸 [PAYOUT] firing expert payout for request={request_id}")
        result = await pay_expert(expert_row["lightning_address"])
        if result.get("success"):
            logger.info(f"✅ [PAYOUT] success for request={request_id} preimage={result.get('preimage', '')[:16]}...")
            try:
                supabase.table("verification_requests").update({
                    "payment_preimage": (result.get("preimage") or "") + "|payout"
                }).eq("id", request_id).execute()
            except Exception:
                pass
        else:
            logger.error(f"❌ [PAYOUT] failed for request={request_id}: {result.get('error')}")
    else:
        logger.warning(f"⚠️ [PAYOUT] skipped for request={request_id} — no lightning_address on expert")


@app.get("/verdict/{request_id}", response_model=VerdictResponse)
async def get_verdict(request_id: str):
    for _ in range(60):
        try:
            result = supabase.table("verification_requests").select(
                "*, experts(id, name, credentials, license_attestation)"
            ).eq("id", request_id).execute()
        except Exception:
            result = supabase.table("verification_requests").select(
                "*, experts(id, name, credentials)"
            ).eq("id", request_id).execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Request not found")

        req = result.data[0]
        if req["status"] == "resolved":
            expert = req.get("experts") or {}

            created = req.get("created_at", "")
            latency = 0.0
            if created:
                try:
                    created_dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
                    latency = (datetime.now(timezone.utc) - created_dt).total_seconds()
                except Exception:
                    pass

            signature = req.get("signature") or ""
            signed_payload = req.get("signed_payload") or {}
            public_key = ""

            if expert.get("id") and not signature:
                keys = ensure_keypair(expert["id"])
                public_key = keys["public_key"]

                signed_payload = build_payload(
                    request_id=request_id,
                    question=req.get("question", ""),
                    ai_draft=req.get("ai_draft", ""),
                    expert_verdict=req.get("expert_verdict", ""),
                    expert_id=expert["id"],
                    expert_name=expert.get("name", ""),
                    license_attestation=expert.get("license_attestation") or "License on file with platform",
                    tier=req.get("tier") or "triage",
                    sats_paid=req.get("sats_paid") or DEMO_TIER_SATS,
                    payment_preimage=req.get("payment_preimage") or "",
                    timestamp=datetime.now(timezone.utc).isoformat(),
                )
                signature = sign_payload(signed_payload, keys["private_key"])

                try:
                    supabase.table("verification_requests").update({
                        "signature": signature,
                        "signed_payload": signed_payload,
                    }).eq("id", request_id).execute()
                except Exception as e:
                    logger.warning(f"could not persist signature ({e}); migration 003 not applied — returning ephemerally")
            elif expert.get("id") and signature:
                keys = ensure_keypair(expert["id"])
                public_key = keys["public_key"]

            return VerdictResponse(
                request_id=request_id,
                expert_verdict=req["expert_verdict"] or "",
                expert_name=expert.get("name", "Expert"),
                expert_credentials=expert.get("credentials", ""),
                license_attestation=expert.get("license_attestation") or "",
                latency_seconds=round(latency, 2),
                signature=signature,
                public_key=public_key,
                signed_payload=signed_payload,
            )

        if req["status"] == "timed_out":
            raise HTTPException(status_code=504, detail="Verification timed out")

        await asyncio.sleep(2)

    supabase.table("verification_requests").update({"status": "timed_out"}).eq("id", request_id).execute()
    raise HTTPException(status_code=504, detail="Verification timed out")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/transactions-summary")
async def transactions_summary():
    """Aggregate per-expert verification stats for the Vouch admin dashboard."""
    try:
        experts_res = supabase.table("experts").select(
            "id, name, specialty, license_attestation"
        ).execute()
        experts_rows = experts_res.data or []
    except Exception as e:
        logger.warning(f"transactions-summary: failed to load experts ({e})")
        experts_rows = []

    try:
        vr_res = supabase.table("verification_requests").select(
            "expert_id, sats_paid, status"
        ).eq("status", "resolved").execute()
        vr_rows = vr_res.data or []
    except Exception as e:
        logger.warning(f"transactions-summary: failed to load verification_requests ({e})")
        vr_rows = []

    by_expert: dict[str, dict] = {}
    for row in vr_rows:
        eid = row.get("expert_id")
        if not eid:
            continue
        bucket = by_expert.setdefault(eid, {"total_sats_earned": 0, "verification_count": 0})
        try:
            bucket["total_sats_earned"] += int(row.get("sats_paid") or 0)
        except (TypeError, ValueError):
            pass
        bucket["verification_count"] += 1

    experts_out = []
    for e in experts_rows:
        eid = e.get("id")
        agg = by_expert.get(eid, {"total_sats_earned": 0, "verification_count": 0})
        experts_out.append({
            "id": eid,
            "name": e.get("name") or "",
            "specialty": e.get("specialty") or "",
            "license_attestation": e.get("license_attestation") or "",
            "total_sats_earned": agg["total_sats_earned"],
            "verification_count": agg["verification_count"],
        })

    experts_out.sort(key=lambda x: x["total_sats_earned"], reverse=True)
    return {"experts": experts_out}
