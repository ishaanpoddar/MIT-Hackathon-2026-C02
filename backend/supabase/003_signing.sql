-- Per-verifier identity (Ed25519 keys + license info).
ALTER TABLE experts ADD COLUMN IF NOT EXISTS public_key TEXT;
ALTER TABLE experts ADD COLUMN IF NOT EXISTS private_key TEXT;
ALTER TABLE experts ADD COLUMN IF NOT EXISTS license_attestation TEXT;

-- Per-request commerce + cryptographic receipt.
ALTER TABLE verification_requests ADD COLUMN IF NOT EXISTS signature TEXT;
ALTER TABLE verification_requests ADD COLUMN IF NOT EXISTS signed_payload JSONB;
ALTER TABLE verification_requests ADD COLUMN IF NOT EXISTS payment_preimage TEXT;
ALTER TABLE verification_requests ADD COLUMN IF NOT EXISTS sats_paid INTEGER;
ALTER TABLE verification_requests ADD COLUMN IF NOT EXISTS tier TEXT;
