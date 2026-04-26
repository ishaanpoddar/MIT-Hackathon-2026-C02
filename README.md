# Vouch AI — Verified Expert Answers

Built for **Hack-Nation x World Bank Youth Summit Global AI Hackathon 2026**.

When an AI is about to give a high-stakes answer (medical, legal, or financial), it autonomously pays a real verified expert ~$1.20 in Bitcoin Lightning to sanity-check the answer before showing it to the end user.

---

## The Challenge

**Spiral Track — "Earn in the Agent Economy"**

The track asked teams to build something where AI agents transact autonomously over Bitcoin Lightning — paying for services, accessing gated APIs, or compensating humans without anyone in the loop pushing buttons. Vouch puts a licensed-expert pay-per-call API behind L402, so any agent in the world can buy a credentialed second opinion for pennies.

---

## Sponsors

- **Spiral** — Track sponsor. Spiral is Block's open-source Bitcoin engineering team. Their challenge framed the brief and shaped the L402 + Agent Wallet flow at the heart of this project.
- **Lightning** — The Lightning Network is the rail every transaction in Vouch AI settles on: agent → API paywall, paywall → expert payout, in-and-out in seconds, sub-cent fees, no card networks involved.
- **Tavily** — Tavily's Search API powers the optional real-time fact-check that runs alongside the expert's verdict, returning citations the user can verify themselves in the receipt modal.

---

## How it works

1. User asks a question in the chat UI
2. AI agent (GPT-4o) drafts an answer and classifies whether it's high-stakes
3. If high-stakes, the agent's Lightning wallet pays 120 SAT via L402 to gate access to the verification endpoint
4. A licensed-specialist persona (with optional Tavily-grounded citations) reviews the AI draft and submits a verdict, signed via Ed25519
5. The expert receives 100 SAT instantly to their Lightning Address
6. User sees the verified answer with the expert's credentials, the signed receipt, and any sources Tavily surfaced

---

## Tech Stack

### Frontend
- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript 5**
- **Tailwind CSS 4** + **shadcn/ui** + **Base UI** for components
- **lucide-react** for icons
- **standardwebhooks** for verifying MoneyDevKit webhook signatures

### Backend
- **Python 3.11** + **FastAPI** + **uvicorn**
- **Pydantic v2** for request/response models
- **Supabase Python client** for Postgres access
- **httpx** for outbound HTTP (Tavily, OpenAI fallbacks)
- **cryptography** for Ed25519 keypair generation + signing of expert verdicts

### Lightning / Bitcoin
- **MoneyDevKit** (`@moneydevkit/nextjs`) — L402 paywall middleware + Agent Wallet integration
- **MoneyDevKit Agent Wallet CLI** (`@moneydevkit/agent-wallet`) — Lightning send/receive used by the backend payouts
- **L402 protocol** — HTTP 402 + macaroons + Lightning preimages for stateless paywalled APIs
- **BOLT12 offers** — used for the in-app receive flow

### LLM & Verification
- **OpenAI GPT-4o** — answer drafting, stakes classification, expert-persona verdict generation
- **OpenAI GPT-4o-mini** — lightweight triage / escalation decision
- **Tavily Search API** — real-time fact-checking with citation sources surfaced in the verification receipt

### Database
- **Supabase** (PostgreSQL) — `experts`, `verification_requests`, signing keypairs, payout ledger

### Deployment
- **Frontend → Vercel** (Next.js native, edge runtime for static, serverless for API routes)
- **Backend → Railway** (Docker, persistent service for Lightning wallet state)
- **Database → Supabase Cloud**

### Built With
- **Cursor** — AI-powered IDE used throughout the build for pair-programming, refactors, and the Telegram-flow rewrite

---

## Repo Layout

```
.
├── frontend/                  Next.js app (chat UI + L402-paywalled API routes)
│   ├── src/app/api/           proxy + paywall routes (chat, triage, verify, wallet, webhooks)
│   ├── src/app/dashboard/     expert / earnings dashboard
│   └── src/lib/receipt.ts     Ed25519 signature verification (browser-side)
├── backend/                   FastAPI app (LLM orchestration + signing + payouts)
│   ├── main.py                /process-stream, /do-verify, /verdict, /health
│   ├── llm.py                 GPT-4o drafting + stakes detection + expert persona
│   ├── tavily.py              fact-check helper
│   ├── signing.py             Ed25519 keypair gen + canonical payload signing
│   ├── payouts.py             Lightning send via @moneydevkit/agent-wallet
│   ├── supabase_client.py     Postgres client
│   └── supabase/              SQL migrations
└── scripts/                   Puppeteer e2e test + screenshots
```

---

## Setup

### Prerequisites

- Node.js 18+
- Python 3.11+
- A Supabase project (URL + service-role key)
- OpenAI API key
- Tavily API key
- MoneyDevKit credentials (`npx @moneydevkit/create`)

### 1. Supabase

Create a Supabase project and run the migrations in `backend/supabase/` in order (`001_initial.sql`, `002_seed_experts.sql`, `003_signing.sql`, `004_seed_keys.sql`).

### 2. Backend

```bash
cd backend
cp .env.example .env
# Fill in: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY,
#         TAVILY_API_KEY, MDK_MNEMONIC, PAYOUT_AMOUNT_SATS
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env
# Fill in: MDK_ACCESS_TOKEN, MDK_MNEMONIC, MDK_WEBHOOK_SECRET,
#         FASTAPI_URL, OPENAI_API_KEY, NEXT_PUBLIC_APP_URL
npm install
npm run dev
```

### 4. Agent Wallet

```bash
npx @moneydevkit/agent-wallet@latest init
# Fund the wallet
npx @moneydevkit/agent-wallet@latest receive 10000
```

---

## Architecture

```
User → Next.js Chat UI → FastAPI /process-stream (LLM draft + stakes detection)
                              ↓ (if high-stakes)
                         Agent wallet pays L402 → Next.js /api/verify
                              ↓
                         FastAPI /do-verify → specialist persona generates verdict
                                            → Tavily fact-check (optional)
                                            → Ed25519 sign payload
                              ↓
                         Agent wallet pays expert via Lightning Address
                              ↓
                         Verdict merged with AI draft → User sees verified answer
                                                      → Receipt modal shows signed payload + sources
```

---

## Money Flow

- Agent pays **120 SAT** (~$1.20) via L402 to access the verification endpoint
- Expert receives **100 SAT** via Lightning Address for their verdict
- ~20 SAT retained as platform margin / Lightning routing fees
- Demo tier (`PAYOUT_AMOUNT_SATS=2`) is configurable for live demos

---

## Verification Receipt

Every verdict is bundled into a canonical JSON payload (request_id, question, AI draft, expert verdict, expert ID, license attestation, tier, sats paid, payment preimage, timestamp), signed by the expert's Ed25519 private key, and surfaced in the frontend receipt modal alongside the public key. Anyone with the public key can re-verify the receipt offline.
