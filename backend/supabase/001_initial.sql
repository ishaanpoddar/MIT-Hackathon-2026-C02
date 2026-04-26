CREATE TABLE IF NOT EXISTS experts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  credentials TEXT NOT NULL,
  specialty TEXT NOT NULL CHECK (specialty IN ('healthcare', 'legal', 'finance', 'general')),
  lightning_address TEXT NOT NULL UNIQUE,
  available BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verification_requests (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  ai_draft TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'resolved', 'timed_out')),
  expert_id UUID REFERENCES experts(id),
  expert_verdict TEXT,
  payment_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  messages JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_experts_available_specialty ON experts(available, specialty);
CREATE INDEX IF NOT EXISTS idx_verification_requests_status ON verification_requests(status);
