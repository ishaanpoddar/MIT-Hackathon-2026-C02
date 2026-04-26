# CONSILIUM — AI + Verified Experts

Built for Hack-Nation x World Bank Youth Summit Global AI Hackathon 2026 — Spiral Track: "Earn in the Agent Economy"

When an AI is about to give a high-stakes answer (medical, legal, or financial), it autonomously pays a real verified human expert ~$1.20 in Bitcoin Lightning to sanity-check the answer before showing it to the end user.

## How it works

1. User asks a question in the chat UI
2. AI agent (GPT-4o) drafts an answer and detects if it's high-stakes
3. If high-stakes, the agent's Lightning wallet pays 120 SAT via L402 to the verification endpoint
4. A specialist persona reviews the AI draft and submits a verdict (signed via Ed25519)
5. Expert gets paid 100 SAT instantly via Lightning Address
6. User sees the verified answer with the expert's credential badge

## Tech Stack

- **Frontend**: Next.js 16 + TypeScript + Tailwind + shadcn/ui
- **Backend**: Python + FastAPI
- **Lightning**: MoneyDevKit (`@moneydevkit/nextjs`) — L402 paywall + Agent Wallet
- **LLM**: OpenAI GPT-4o
- **Database**: Supabase (PostgreSQL)

## Repo Layout

- `frontend/` — Next.js app (chat UI + L402-paywalled API routes)
- `backend/` — FastAPI app (LLM orchestration + Supabase + Ed25519 signing)
- `backend/supabase/` — Schema migrations

## Setup

### Prerequisites

- Node.js 18+
- Python 3.11+
- A Supabase project
- An OpenAI API key
- MoneyDevKit credentials (`npx @moneydevkit/create`)

### 1. Supabase

Create a new Supabase project and run the SQL in `supabase/001_initial.sql` in the SQL editor.

### 2. Backend

```bash
cd backend
cp .env.example .env
# Fill in .env with your credentials
pip install -r requirements.txt
python main.py
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env
# Fill in .env with your MoneyDevKit + OpenAI credentials
npm install
npm run dev
```

### 4. Agent Wallet

```bash
npx @moneydevkit/agent-wallet@latest init
# Fund the wallet using the receive command
npx @moneydevkit/agent-wallet@latest receive 10000
```

## Architecture

```
User → Next.js Chat UI → FastAPI /process-stream (LLM draft + stakes detection)
                              ↓ (if high-stakes)
                         Agent wallet pays L402 → Next.js /api/verify
                              ↓
                         FastAPI /do-verify → specialist persona generates verdict
                              ↓
                         Agent wallet pays expert via Lightning Address
                              ↓
                         Verdict merged with AI draft → User sees verified answer
```

## Money Flow

- Agent pays **120 SAT** (~$1.20) via L402 to access the verification endpoint
- Expert receives **100 SAT** via Lightning Address for their verdict
- ~20 SAT retained as platform margin / Lightning routing fees
