import os
import asyncio
import logging
from dotenv import load_dotenv
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, Bot
from telegram.ext import Application, CommandHandler, CallbackQueryHandler, MessageHandler, filters, ContextTypes
from supabase_client import supabase

load_dotenv()

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_ENABLED = os.environ.get("TELEGRAM_ENABLED", "false").lower() == "true"
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DOMAIN_MAP = {
    "healthcare": "Medical",
    "legal": "Legal",
    "finance": "Finance",
    "general": "General",
}

pending_verifications: dict[str, dict] = {}
_bot_app: Application | None = None


def get_expert(chat_id: int) -> dict | None:
    result = supabase.table("experts").select("*").eq("telegram_chat_id", chat_id).execute()
    if result.data:
        return result.data[0]
    return None


async def start_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(
        "Welcome to CONSILIUM Expert Bot! \n\n"
        "You can earn Bitcoin by verifying AI-generated answers in your area of expertise.\n\n"
        "Commands:\n"
        "/register <name> | <credentials> | <specialty> | <lightning_address>\n"
        "  Example: /register Dr. Mehta | MBBS, 8 yrs experience | healthcare | mehta@cash.app\n\n"
        "/available — Go on call (receive verification requests)\n"
        "/busy — Go off call\n"
        "/status — Check your registration and availability\n"
        "/help — Show this message"
    )


async def register_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id
    text = update.message.text

    parts = text.replace("/register", "").strip().split("|")
    if len(parts) != 4:
        await update.message.reply_text(
            "Format: /register <name> | <credentials> | <specialty> | <lightning_address>\n\n"
            "Specialties: healthcare, legal, finance, general\n"
            "Lightning address: your@cash.app or any Lightning address"
        )
        return

    name = parts[0].strip()
    credentials = parts[1].strip()
    specialty = parts[2].strip().lower()
    lightning_address = parts[3].strip()

    if specialty not in DOMAIN_MAP:
        await update.message.reply_text(f"Specialty must be one of: {', '.join(DOMAIN_MAP.keys())}")
        return

    existing = get_expert(chat_id)
    if existing:
        supabase.table("experts").update({
            "name": name,
            "credentials": credentials,
            "specialty": specialty,
            "lightning_address": lightning_address,
        }).eq("id", existing["id"]).execute()
        await update.message.reply_text(f"Updated registration for {name}!")
    else:
        supabase.table("experts").insert({
            "telegram_chat_id": chat_id,
            "name": name,
            "credentials": credentials,
            "specialty": specialty,
            "lightning_address": lightning_address,
            "available": False,
        }).execute()
        await update.message.reply_text(
            f"Registered {name} ({credentials}) — {DOMAIN_MAP[specialty]} specialty.\n\n"
            f"Lightning address: {lightning_address}\n\n"
            f"Send /available to start receiving verification requests!"
        )


async def available_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id
    expert = get_expert(chat_id)

    if not expert:
        await update.message.reply_text("You're not registered yet. Use /register first.")
        return

    supabase.table("experts").update({"available": True}).eq("id", expert["id"]).execute()
    await update.message.reply_text("You're now ON CALL. You'll receive verification requests for your specialty.")


async def busy_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id
    expert = get_expert(chat_id)

    if not expert:
        await update.message.reply_text("You're not registered yet. Use /register first.")
        return

    supabase.table("experts").update({"available": False}).eq("id", expert["id"]).execute()
    await update.message.reply_text("You're now OFF CALL. You won't receive requests until you /available again.")


async def status_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id
    expert = get_expert(chat_id)

    if not expert:
        await update.message.reply_text("You're not registered yet. Use /register first.")
        return

    status = "ON CALL" if expert["available"] else "OFF CALL"
    await update.message.reply_text(
        f"Name: {expert['name']}\n"
        f"Credentials: {expert['credentials']}\n"
        f"Specialty: {DOMAIN_MAP.get(expert['specialty'], expert['specialty'])}\n"
        f"Lightning: {expert['lightning_address']}\n"
        f"Status: {status}"
    )


async def claim_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()

    chat_id = query.effective_chat.id
    data = query.data

    if not data.startswith("claim_"):
        return

    request_id = data.replace("claim_", "")

    expert = get_expert(chat_id)
    if not expert:
        await query.edit_message_reply_markup(reply_markup=None)
        await query.message.reply_text("You're not registered. Use /register first.")
        return

    request_data = supabase.table("verification_requests").select("*").eq("id", request_id).execute()
    if not request_data.data:
        await query.edit_message_reply_markup(reply_markup=None)
        await query.message.reply_text("This request no longer exists.")
        return

    req = request_data.data[0]
    if req["status"] != "pending":
        await query.edit_message_reply_markup(reply_markup=None)
        await query.message.reply_text("This request has already been claimed.")
        return

    supabase.table("verification_requests").update({
        "status": "claimed",
        "expert_id": expert["id"],
    }).eq("id", request_id).execute()

    await query.edit_message_reply_markup(reply_markup=None)

    label = DOMAIN_MAP.get(req["domain"], "General")
    await query.message.reply_text(
        f"*Verification Claimed* — {label}\n"
        f"------------------------\n"
        f"*Question:*\n_{req['question']}_\n\n"
        f"*AI Draft:*\n{req['ai_draft']}\n\n"
        f"------------------------\n"
        f"Reply to THIS message with your professional verdict.",
        parse_mode="Markdown",
    )

    pending_verifications[request_id] = {
        "chat_id": chat_id,
        "expert": expert,
    }


async def verdict_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id
    reply_to = update.message.reply_to_message

    if not reply_to:
        return

    original_text = reply_to.text or ""
    request_id = None
    for line in original_text.split("\n"):
        if "Request ID:" in line:
            try:
                request_id = line.split("`")[1]
            except IndexError:
                pass
            break

    if not request_id:
        return

    request_data = supabase.table("verification_requests").select("*").eq("id", request_id).execute()
    if not request_data.data or request_data.data[0]["status"] != "claimed":
        await update.message.reply_text("This request is no longer active.")
        return

    verdict_text = update.message.text or ""

    supabase.table("verification_requests").update({
        "status": "resolved",
        "expert_verdict": verdict_text,
    }).eq("id", request_id).execute()

    expert = get_expert(chat_id)
    await update.message.reply_text(
        f"Verdict submitted! You'll receive {os.environ.get('PAYOUT_AMOUNT_SATS', '100')} sats shortly."
    )

    if expert and expert.get("lightning_address"):
        from payouts import pay_expert
        payout_result = await pay_expert(expert["lightning_address"])
        if payout_result["success"]:
            await update.message.reply_text(
                f"Payment sent! {os.environ.get('PAYOUT_AMOUNT_SATS', '100')} sats → {expert['lightning_address']}"
            )
        else:
            await update.message.reply_text(f"Payment failed: {payout_result['error']}")


async def send_verification_request(request_id: str, question: str, ai_draft: str, domain: str) -> list[int]:
    if not TELEGRAM_ENABLED or _bot_app is None:
        return []

    result = supabase.table("experts").select("*").eq("available", True).eq("specialty", domain).execute()
    experts = result.data

    if not experts:
        all_experts = supabase.table("experts").select("*").eq("available", True).execute()
        experts = all_experts.data

    if not experts:
        return []

    label = DOMAIN_MAP.get(domain, "General")
    notified = []

    bot = _bot_app.bot if _bot_app else Bot(token=BOT_TOKEN)

    for expert in experts:
        try:
            keyboard = InlineKeyboardMarkup([
                [InlineKeyboardButton("Claim This Verification", callback_data=f"claim_{request_id}")]
            ])

            await bot.send_message(
                chat_id=expert["telegram_chat_id"],
                text=(
                    f"*New Verification Request* — {label}\n"
                    f"------------------------\n"
                    f"*Question:*\n_{question}_\n\n"
                    f"*Request ID:* `{request_id}`\n\n"
                    f"Tap below to claim and earn sats!"
                ),
                parse_mode="Markdown",
                reply_markup=keyboard,
            )
            notified.append(expert["telegram_chat_id"])
        except Exception as e:
            logger.error(f"Failed to notify expert {expert['name']}: {e}")

    return notified


async def init_bot():
    global _bot_app
    if not TELEGRAM_ENABLED:
        logger.info("Telegram disabled (TELEGRAM_ENABLED != true) — skipping bot startup")
        return
    if not BOT_TOKEN:
        logger.warning("TELEGRAM_BOT_TOKEN not set, skipping bot startup")
        return

    _bot_app = Application.builder().token(BOT_TOKEN).build()

    _bot_app.add_handler(CommandHandler("start", start_cmd))
    _bot_app.add_handler(CommandHandler("register", register_cmd))
    _bot_app.add_handler(CommandHandler("available", available_cmd))
    _bot_app.add_handler(CommandHandler("busy", busy_cmd))
    _bot_app.add_handler(CommandHandler("status", status_cmd))
    _bot_app.add_handler(CommandHandler("help", start_cmd))
    _bot_app.add_handler(CallbackQueryHandler(claim_callback))
    _bot_app.add_handler(MessageHandler(filters.REPLY & filters.TEXT & ~filters.COMMAND, verdict_handler))

    await _bot_app.initialize()
    await _bot_app.start()
    await _bot_app.updater.start_polling(allowed_updates=Update.ALL_TYPES)
    logger.info("Telegram bot started and polling")
