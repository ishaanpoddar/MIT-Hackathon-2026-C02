import os
import sys
import json
import shutil
import logging
import subprocess
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("vouch.payouts")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")

PAYOUT_AMOUNT_SATS = int(os.environ.get("PAYOUT_AMOUNT_SATS", "100"))


def _resolve_npx() -> str:
    """Return a usable npx executable path (handles Windows npx.cmd)."""
    if sys.platform == "win32":
        for candidate in ("npx.cmd", "npx.exe", "npx"):
            found = shutil.which(candidate)
            if found:
                return found
        for hint in (
            r"C:\Program Files\nodejs\npx.cmd",
            r"C:\Program Files (x86)\nodejs\npx.cmd",
        ):
            if os.path.exists(hint):
                return hint
        return "npx.cmd"
    return shutil.which("npx") or "npx"


NPX = _resolve_npx()
logger.info(f"[payouts] using npx at: {NPX}")


def _normalize_destination(raw: str) -> str:
    """Strip BIP21 wrappers so MDK gets the bare destination string."""
    s = (raw or "").strip()
    # bitcoin:?lno=lno1... or bitcoin:?lightning=lnbc...
    if s.lower().startswith("bitcoin:"):
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(s)
        params = parse_qs(parsed.query)
        for key in ("lno", "lightning", "lnurl"):
            if key in params and params[key]:
                return params[key][0]
        # fallback: drop the "bitcoin:" prefix
        return s.split(":", 1)[1].lstrip("?")
    if s.lower().startswith("lightning:"):
        return s.split(":", 1)[1]
    return s


async def pay_expert(lightning_address: str, amount_sats: int = PAYOUT_AMOUNT_SATS) -> dict:
    destination = _normalize_destination(lightning_address)
    dest_short = destination[:30] + "..." if len(destination) > 30 else destination

    logger.info(f"💸 [SATS-OUT] sending {amount_sats} sats → {dest_short}")
    try:
        result = subprocess.run(
            [NPX, "@moneydevkit/agent-wallet@latest", "send", destination, str(amount_sats)],
            capture_output=True,
            text=True,
            timeout=60,
            shell=False,
        )
        if result.returncode != 0:
            err = result.stderr.strip() or result.stdout.strip() or "unknown error"
            logger.error(f"❌ [SATS-OUT] FAILED to send {amount_sats} sats → {dest_short}: {err}")
            return {"success": False, "error": err}
        data = json.loads(result.stdout.strip())
        preimage = data.get("preimage", "")
        payment_hash = data.get("payment_hash", "")
        logger.info(
            f"✅ [SATS-OUT] SENT {amount_sats} sats → {dest_short} "
            f"| preimage={preimage[:16]}... | hash={payment_hash[:16]}..."
        )
        return {"success": True, "payment_hash": payment_hash, "preimage": preimage, "data": data}
    except subprocess.TimeoutExpired:
        logger.error(f"❌ [SATS-OUT] TIMEOUT sending {amount_sats} sats → {dest_short}")
        return {"success": False, "error": "Payment timed out"}
    except Exception as e:
        logger.error(f"❌ [SATS-OUT] EXCEPTION sending {amount_sats} sats → {dest_short}: {e}")
        return {"success": False, "error": str(e)}
