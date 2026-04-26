import os
from openai import OpenAI
from dotenv import load_dotenv
from pydantic import BaseModel

load_dotenv()

client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

DRAFT_SYSTEM_PROMPT = """You are an AI clinical-triage assistant drafting a response that will be reviewed by a licensed expert before reaching the user.

Be direct, clinical, and confident in your draft. Provide concrete guidance the expert can confirm, refine, or correct.

DO NOT say "I'm not a doctor" or "I cannot give medical advice" or any similar disclaimer. A licensed professional is reviewing every word before the user sees it. Hedging is unhelpful — the expert handles uncertainty.

Keep it under 180 words. No bullet lists unless the question really requires them. Plain prose preferred."""

STAKES_SYSTEM_PROMPT = """You are a classifier. Given a user question, determine if it is high-stakes and requires professional human verification.

A question is high-stakes if:
- It's medical and involves symptoms, diagnosis, treatment, or health concerns
- It's legal and involves rights, contracts, liability, or legal action
- It's financial and involves significant money, investments, debt, or major financial decisions

Return a JSON object with exactly these fields:
- "needs_verification": boolean
- "confidence": float from 0 to 1 (how confident you are in the AI answer)
- "domain": one of "healthcare", "legal", "finance", "general"
- "subspecialty": short specialty name appropriate to the question. Examples:
    healthcare → "Dermatology", "Cardiology", "Pediatrics", "Neurology", "Internal Medicine", "Orthopedics", "Psychiatry", "OB/GYN", "Endocrinology"
    legal → "Family Law", "Immigration Law", "Tax Law", "Employment Law", "Criminal Defense", "Estate Planning", "Contract Law", "IP Law"
    finance → "Personal Finance", "Tax", "Retirement Planning", "Investment Advisory", "Debt Counseling", "Estate Planning"
    general → "General"
- "reasoning": brief string explaining why

A question should be flagged for verification if confidence < 0.7 and domain is healthcare, legal, or finance."""


class DraftResult(BaseModel):
    draft: str


class StakesResult(BaseModel):
    needs_verification: bool
    confidence: float
    domain: str
    subspecialty: str = "General"
    reasoning: str


async def generate_draft(question: str) -> DraftResult:
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": DRAFT_SYSTEM_PROMPT},
            {"role": "user", "content": question},
        ],
        temperature=0.7,
        max_tokens=500,
    )
    return DraftResult(draft=response.choices[0].message.content or "")


async def detect_stakes(question: str) -> StakesResult:
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": STAKES_SYSTEM_PROMPT},
            {"role": "user", "content": question},
        ],
        temperature=0,
        max_tokens=200,
        response_format={"type": "json_object"},
    )
    import json
    data = json.loads(response.choices[0].message.content or "{}")
    return StakesResult(
        needs_verification=data.get("needs_verification", False),
        confidence=data.get("confidence", 0.5),
        domain=data.get("domain", "general"),
        subspecialty=data.get("subspecialty", "General"),
        reasoning=data.get("reasoning", ""),
    )


EXPERT_PERSONAS = {
    "healthcare": {
        "name": "Dr. Sarah Chen",
        "title": "Board-Certified Physician",
        "credentials": "MD Internal Medicine, Stanford 2014 · 9 yrs experience",
        "style": (
            "Speak in first person. Be clinically specific — cite exact dosages, thresholds, time windows where applicable. "
            "Flag any red-flag symptoms the AI may have missed. End with a clear actionable recommendation. "
            "Use plain language. Do not say 'I am not a doctor' — you ARE the doctor."
        ),
    },
    "legal": {
        "name": "Atty. Marcus Johnson",
        "title": "Attorney at Law",
        "credentials": "JD Harvard Law 2009 · NY & CA Bars · 12 yrs experience",
        "style": (
            "Speak in first person. Note jurisdiction-dependence where relevant. Be specific about deadlines, rights, and "
            "documentation requirements. Recommend concrete next steps. Don't give legal advice that requires knowing the user's "
            "specific facts — instead, list what they need to gather/decide before consulting a local attorney."
        ),
    },
    "finance": {
        "name": "Jennifer Park, CPA",
        "title": "CPA, CFA",
        "credentials": "CPA, CFA · Wharton 2011 · 10 yrs experience",
        "style": (
            "Speak in first person. Cite specific tax implications, percentage costs, or trade-offs where applicable. "
            "Note when a decision depends on individual circumstances and what those are. Recommend concrete alternatives "
            "before any drastic action."
        ),
    },
    "general": {
        "name": "Expert Panel",
        "title": "Multi-domain Verifier",
        "credentials": "Cross-disciplinary review",
        "style": "Speak directly. Confirm what's accurate, flag what's missing or imprecise, and suggest where professional consultation is warranted.",
    },
}


class ExpertVerdict(BaseModel):
    verdict: str
    sources: list = []
    fact_check_used: bool = False


async def generate_expert_verdict(
    question: str,
    ai_draft: str,
    domain: str,
    subspecialty: str = "",
    fact_check: dict | None = None,
) -> ExpertVerdict:
    """Generate a dynamic, contextual expert response per question.

    Uses GPT-4o with an expert persona. Persona's title is dynamically set
    to the detected subspecialty (e.g. "Board-Certified Dermatologist") so
    each question feels reviewed by the right kind of specialist.

    Optionally augmented with Tavily fact-check results (sources + answer).
    """
    persona = dict(EXPERT_PERSONAS.get(domain, EXPERT_PERSONAS["general"]))
    if subspecialty and subspecialty.lower() != "general":
        if domain == "healthcare":
            persona["title"] = f"Board-Certified {subspecialty} Specialist"
            persona["credentials"] = f"MD {subspecialty}, Stanford 2014 · 9 yrs experience"
        elif domain == "legal":
            persona["title"] = f"{subspecialty} Attorney"
            persona["credentials"] = f"JD Harvard Law 2009 · {subspecialty} · 12 yrs experience"
        elif domain == "finance":
            persona["title"] = f"{subspecialty} Specialist"
            persona["credentials"] = f"CPA, CFA · Wharton 2011 · {subspecialty} · 10 yrs experience"

    sources_block = ""
    sources_list: list = []
    fact_check_used = False
    if fact_check and fact_check.get("sources"):
        sources_list = fact_check["sources"]
        fact_check_used = True
        tavily_answer = fact_check.get("tavily_answer", "")
        sources_text = "\n".join(
            f"- {s.get('title', '')}: {s.get('snippet', '')[:200]} ({s.get('url', '')})"
            for s in sources_list
        )
        sources_block = (
            f"\n\nAuthoritative reference summary (from web search):\n{tavily_answer}\n\n"
            f"Top sources:\n{sources_text}\n"
        )

    system_prompt = (
        f"You are {persona['name']}, a {persona['title']} ({persona['credentials']}). "
        f"You are reviewing an AI's draft answer to a user's question and giving your professional verdict. "
        f"The user will read what you write directly — speak as yourself, not about the AI.\n\n"
        f"Style: {persona['style']}\n\n"
        f"Length: 80-150 words. No headings. No bullet lists unless the question genuinely requires enumeration. "
        f"Plain prose preferred. Be precise where the question is precise."
    )

    user_prompt = (
        f"User's question:\n{question}\n\n"
        f"AI's draft answer (which you may correct, expand, or replace):\n{ai_draft}"
        f"{sources_block}\n\n"
        f"Write your professional response to the user."
    )

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.4,
        max_tokens=400,
    )

    verdict_text = (response.choices[0].message.content or "").strip()
    return ExpertVerdict(
        verdict=verdict_text,
        sources=sources_list,
        fact_check_used=fact_check_used,
    )
