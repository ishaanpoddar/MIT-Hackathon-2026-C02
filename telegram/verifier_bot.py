"""
Verifier Bot — Telegram-backed human verification service for the agent.

Architecture:
    [Agent backend]  --POST /verify-->  [This service]  --sendMessage-->  [Telegram]
                                              |                                |
                                              |<--getUpdates (polling)---------|
                                              |
                                            (returns verifier's reply in HTTP response)

Setup (one-time, ~5 min):
    1. Open Telegram, search @BotFather, send /newbot, follow prompts.
       Save the bot token it gives you (looks like "123456:ABC-DEF...").
    2. Search for your new bot in Telegram and send it ANY message (e.g. "hi").
    3. Get your chat ID: open https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
       in a browser. Look for "chat":{"id": <NUMBER>, ...}. Save that number.
    4. Copy .env.example to .env and fill in the values.
    5. pip install -r requirements.txt
    6. python -m uvicorn verifier_bot:app --port 8000
    7. Test:  python test_call.py

HTTP contract (for your partner's agent):
    POST http://localhost:8000/verify
    Body: { "question": "...", "domain": "healthcare|legal|finance|general" }
    Returns (after verifier replies, or 504 after 120s timeout):
    {
        "request_id": "abc12345",
        "verified_answer": "<verifier's reply text>",
        "verifier_name": "Dr. Mehta",
        "verifier_credentials": "MBBS, 8 yrs experience, Mumbai",
        "latency_seconds": 14.3
    }
"""

import asyncio
import os
import time
import uuid
from contextlib import asynccontextmanager
from typing import Dict, Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

load_dotenv()

BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
VERIFIER_CHAT_ID = int(os.environ["VERIFIER_CHAT_ID"])
VERIFIER_NAME = os.environ.get("VERIFIER_NAME", "Dr. Mehta")
VERIFIER_CREDENTIALS = os.environ.get(
    "VERIFIER_CREDENTIALS", "MBBS, 8 yrs experience, Mumbai"
)
TIMEOUT_SECONDS = int(os.environ.get("VERIFIER_TIMEOUT", "120"))

TG_API = f"https://api.telegram.org/bot{BOT_TOKEN}"

# Per-domain message styling so the Telegram message looks distinct on screen
DOMAIN_BADGES = {
    "healthcare": "Medical",
    "legal":      "Legal",
    "finance":    "Finance",
    "general":    "General",
}

# In-memory state — fine for a single-laptop hackathon service
pending: Dict[str, Dict] = {}  # request_id -> {event, answer, started_at}
last_update_id = 0


async def tg_send(chat_id: int, text: str) -> dict:
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            f"{TG_API}/sendMessage",
            json={
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "Markdown",
                "disable_web_page_preview": True,
            },
        )
        return r.json()


def _extract_request_id(original_text: str) -> Optional[str]:
    """Pull the request_id out of the original verification message we sent."""
    for line in original_text.split("\n"):
        if "ID:" in line and "`" in line:
            try:
                return line.split("`")[1]
            except IndexError:
                continue
    return None


async def telegram_poller():
    """Long-poll Telegram for replies; resolve pending requests when matches arrive."""
    global last_update_id
    while True:
        try:
            async with httpx.AsyncClient(timeout=35) as client:
                r = await client.get(
                    f"{TG_API}/getUpdates",
                    params={"offset": last_update_id + 1, "timeout": 30},
                )
            data = r.json()
            for update in data.get("result", []):
                last_update_id = update["update_id"]
                msg = update.get("message")
                if not msg:
                    continue
                reply_to = msg.get("reply_to_message")
                if not reply_to:
                    await tg_send(
                        msg["chat"]["id"],
                        "Please *reply* directly to a verification request to send your answer back.",
                    )
                    continue
                original = reply_to.get("text", "")
                request_id = _extract_request_id(original)
                if not request_id:
                    continue
                if request_id not in pending:
                    await tg_send(
                        msg["chat"]["id"],
                        f"Request `{request_id}` is no longer pending (timed out or already answered).",
                    )
                    continue
                pending[request_id]["answer"] = msg.get("text", "")
                pending[request_id]["event"].set()
                await tg_send(
                    msg["chat"]["id"],
                    f"Verification `{request_id}` sent back to the agent.",
                )
        except Exception as e:
            print(f"[poller] error: {e}")
            await asyncio.sleep(2)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(telegram_poller())
    print(f"[startup] polling Telegram, verifier chat = {VERIFIER_CHAT_ID}")
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(lifespan=lifespan, title="Verifier Bot")


class VerifyRequest(BaseModel):
    question: str
    domain: str = "general"


class VerifyResponse(BaseModel):
    request_id: str
    verified_answer: str
    verifier_name: str
    verifier_credentials: str
    latency_seconds: float


@app.post("/verify", response_model=VerifyResponse)
async def verify(req: VerifyRequest):
    request_id = uuid.uuid4().hex[:8]
    event = asyncio.Event()
    started = time.monotonic()
    pending[request_id] = {"event": event, "answer": None, "started_at": started}

    label = DOMAIN_BADGES.get(req.domain.lower(), DOMAIN_BADGES["general"])

    body = (
        f"*Verification Request*\n"
        f"------------------------\n"
        f"*Domain:* {label}\n"
        f"*ID:* `{request_id}`\n\n"
        f"*Question:*\n_{req.question}_\n\n"
        f"------------------------\n"
        f"_Reply to this message with your verification._"
    )
    send_result = await tg_send(VERIFIER_CHAT_ID, body)
    if not send_result.get("ok"):
        pending.pop(request_id, None)
        raise HTTPException(
            status_code=502,
            detail=f"Telegram send failed: {send_result}",
        )

    try:
        await asyncio.wait_for(event.wait(), timeout=TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        pending.pop(request_id, None)
        await tg_send(
            VERIFIER_CHAT_ID,
            f"Request `{request_id}` timed out after {TIMEOUT_SECONDS}s. Agent will fall back.",
        )
        raise HTTPException(status_code=504, detail="Verifier did not respond in time")

    answer = pending[request_id]["answer"]
    pending.pop(request_id, None)
    return VerifyResponse(
        request_id=request_id,
        verified_answer=answer,
        verifier_name=VERIFIER_NAME,
        verifier_credentials=VERIFIER_CREDENTIALS,
        latency_seconds=round(time.monotonic() - started, 2),
    )


@app.get("/health")
async def health():
    return {"status": "ok", "pending_requests": len(pending)}
