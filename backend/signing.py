import hashlib
import json
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives import serialization
from supabase_client import supabase


def _generate_keypair() -> tuple[str, str]:
    sk = Ed25519PrivateKey.generate()
    pk = sk.public_key()
    sk_bytes = sk.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    pk_bytes = pk.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return sk_bytes.hex(), pk_bytes.hex()


_ephemeral_keys: dict[str, dict] = {}


def ensure_keypair(expert_id: str) -> dict:
    """Return (private_key_hex, public_key_hex) for an expert.

    Tries to read/persist via Supabase. Falls back to in-memory if columns
    are missing (migration 003 not applied). Per-process cache keeps the
    same key across calls in either path.
    """
    if expert_id in _ephemeral_keys:
        return _ephemeral_keys[expert_id]

    try:
        result = supabase.table("experts").select("private_key, public_key").eq("id", expert_id).execute()
        if result.data:
            row = result.data[0]
            if row.get("private_key") and row.get("public_key"):
                keys = {"private_key": row["private_key"], "public_key": row["public_key"]}
                _ephemeral_keys[expert_id] = keys
                return keys
    except Exception:
        pass

    sk_hex, pk_hex = _generate_keypair()
    keys = {"private_key": sk_hex, "public_key": pk_hex}
    _ephemeral_keys[expert_id] = keys

    try:
        supabase.table("experts").update({
            "private_key": sk_hex,
            "public_key": pk_hex,
        }).eq("id", expert_id).execute()
    except Exception:
        pass

    return keys


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def build_payload(
    request_id: str,
    question: str,
    ai_draft: str,
    expert_verdict: str,
    expert_id: str,
    expert_name: str,
    license_attestation: str,
    tier: str,
    sats_paid: int,
    payment_preimage: str,
    timestamp: str,
) -> dict:
    return {
        "version": "vouch-receipt-v1",
        "request_id": request_id,
        "question_hash": sha256_hex(question),
        "ai_draft_hash": sha256_hex(ai_draft),
        "verdict_hash": sha256_hex(expert_verdict),
        "verifier_id": expert_id,
        "verifier_name": expert_name,
        "license_attestation": license_attestation,
        "tier": tier,
        "sats_paid": sats_paid,
        "payment_preimage": payment_preimage,
        "timestamp": timestamp,
    }


def sign_payload(payload: dict, private_key_hex: str) -> str:
    sk_bytes = bytes.fromhex(private_key_hex)
    sk = Ed25519PrivateKey.from_private_bytes(sk_bytes)
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    signature = sk.sign(canonical)
    return signature.hex()


def verify_signature(payload: dict, signature_hex: str, public_key_hex: str) -> bool:
    try:
        pk = Ed25519PublicKey.from_public_bytes(bytes.fromhex(public_key_hex))
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        pk.verify(bytes.fromhex(signature_hex), canonical)
        return True
    except Exception:
        return False
