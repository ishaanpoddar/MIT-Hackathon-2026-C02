# Vouch — Technical Documentation

> Lightning-paywalled marketplace where AI agents pay licensed human experts to verify high-stakes answers.
>
> Built for **Spiral × Hack-Nation × MIT Global AI Hackathon 2026** — Spiral's *"Earn in the Agent Economy"* challenge.

---

## 1 · What we're solving

### 1.1 Spiral's thesis

> *"Agents are the new customers, build something they'll pay for."*
> *"Build a web service, API, or tool that allows agents to transact value. Your project must use the Lightning Network as the payment rail."*

Spiral's bonus criterion: *"Lightning isn't just tacked on, but actually enables something that wouldn't work with traditional payment systems."*

### 1.2 The actual problem

AI agents in regulated verticals (medical / legal / financial) get most questions right but **break on high-stakes edge cases**. A telehealth chatbot that's confidently wrong about pediatric dosing isn't just unhelpful — it's dangerous. The fix is human verification per query.

But the *payment rail* is what's missing:
- An AI agent can't open a Stripe account.
- An AI agent can't pass KYC, sign a Terms of Service, or hold a credit card.
- A licensed doctor in Mumbai or Manila can't easily plug into Stripe Connect to receive $1 per consultation.
- Stripe's fixed minimum is **$0.30 + 2.9%** per transaction. At per-query economics ($0.05 to $5 per question), card fees consume 6%–600% of the value.

Lightning solves all four constraints structurally:
- Account-less authentication via L402
- Sub-cent per-payment fees
- Permissionless global supply
- Self-custodial recipients (no platform onboarding)

### 1.3 What we built

**Vouch** — an L402-paywalled marketplace exposed to AI products as a verification API. The merchant (in our demo: a telehealth chatbot called **VitalsAI**) integrates Vouch's `/api/verify` endpoint. When the agent decides escalation is worth the cost, it pays in Lightning, our backend dispatches the question to a registered expert, the expert returns a verdict, and we pay the expert in Lightning. End-user never sees the payment layer.

We hit two of Spiral's suggested directions in one product:
1. **Sell something agents need** — verification
2. **Keep humans in the loop** — humans handle the judgment calls only humans can

---

## 2 · Tech stack

### 2.1 Frontend
| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 16** (App Router, Turbopack) | Streaming SSE responses, edge-friendly API routes, real React 19 |
| Language | **TypeScript** | Strict types across SSE event protocol, payment payloads, signed receipts |
| Styling | **Tailwind CSS v4** + **shadcn/ui** | Fast iteration, consistent components |
| Crypto | **WebCrypto SubtleCrypto** (Ed25519 verify) | Native browser verification of signed receipts — no JS crypto library needed |
| Lightning | **`@moneydevkit/nextjs`** | L402 middleware (`withDeferredSettlement`), MDK plugin for Next.js |
| Icons | `lucide-react` | |

### 2.2 Backend
| Layer | Choice | Why |
|---|---|---|
| Framework | **FastAPI** + **Uvicorn** | Async streaming, fast iteration, Pydantic models |
| Language | **Python 3.12** | OpenAI / Tavily / cryptography ecosystem |
| Crypto | **`cryptography`** (Ed25519) | Server-side keypair gen + signing of verdicts |
| HTTP | `httpx` (async) | Tavily search, Telegram bot, MDK-side calls |
| Persistence client | `supabase-py` | Postgres queries via Supabase REST + Realtime |

### 2.3 AI
| Layer | Choice | Why |
|---|---|---|
| Drafting + Stakes Classifier | **OpenAI GPT-4o** | High-fidelity classification with structured JSON output, expert persona generation |
| Triage agent | **OpenAI GPT-4o-mini** | Cheap, fast second-opinion before paying for human review (~$0.001/call) |
| Fact-checking | **Tavily Search API** | Real-time authoritative web sources, summary + citations per question |
| Persona engine | Dynamic — domain → subspecialty → role | LLM detects "Dermatology" / "Tax Law" / etc. and the expert persona is generated to match |

### 2.4 Lightning + Bitcoin
| Layer | Choice | Why |
|---|---|---|
| Agent wallet | **MoneyDevKit `@moneydevkit/agent-wallet`** | Self-custodial LDK Node, JSON-over-HTTP daemon on `localhost:3456`, BOLT11 + BOLT12 + LNURL + Lightning Address support |
| Paywall | **L402 protocol** via `@moneydevkit/nextjs` `withDeferredSettlement` | Payment-as-authentication. Macaroon + preimage = proof of access |
| LSP | `lsp.moneydevkit.com:9735` | Wraps invoices, opens just-in-time channels, BOLT12 receive support via LSPS4 |
| Funding wallet | **Phoenix** (Acinq) | Self-custodial mobile wallet for funding the agent + receiving expert payouts |
| Receive format | **BOLT12 offers** | Reusable, no expiry, sender picks amount — one offer per expert, paid forever |

### 2.5 Storage
| Layer | Choice | Why |
|---|---|---|
| Database | **Supabase Postgres** | RLS, REST + Realtime in one service, free tier sufficient for hackathon |
| Schema | `experts` (id, name, credentials, lightning_address, public_key, license_attestation, specialty), `verification_requests` (id, question, ai_draft, expert_verdict, signature, signed_payload, payment_preimage, sats_paid, tier, status) | |

### 2.6 DevOps / Tooling
| Layer | Choice | Why |
|---|---|---|
| Public tunnel | **VS Code Dev Tunnels** | Public HTTPS for MDK webhook callback to localhost during dev |
| Headless test | **`puppeteer-core`** + system Chrome | Automated browser walkthroughs, screenshots, signature verification |

---

## 3 · Architecture

### 3.1 The diagram

```
                      ┌──────────────────────────────────┐
                      │            BROWSER               │
                      │  ┌────────────┐ ┌──────────────┐ │
                      │  │ VitalsAI / │ │     Vouch    │ │
                      │  │ consumer   │ │  /dashboard  │ │
                      │  │    chat    │ │   admin view │ │
                      │  └─────┬──────┘ └──────┬───────┘ │
                      └────────┼───────────────┼─────────┘
                               │               │
                               ▼               ▼
              ┌─────────────────────────────────────────────┐
              │       NEXT.JS 16 (TYPESCRIPT, SSE)          │
              │ ┌────────────┬────────────┬───────────────┐ │
              │ │ /api/chat  │/api/triage │ /api/verify   │ │
              │ │ SSE proxy  │ L402:1 sat │ L402:2 sat    │ │
              │ │ + L402     │ GPT-4o-mini│ withDeferred… │ │
              │ │   dance    │            │  Settlement   │ │
              │ └─────┬──────┴────────────┴───────┬───────┘ │
              │       │                           │         │
              │ ┌─────┴────┐  ┌──────────────┐  ┌─┴───────┐ │
              │ │/api/wallet│ │/api/wallet/  │  │/api/    │ │
              │ │  balance  │ │  transactions│  │webhooks/│ │
              │ │           │ │  + receive   │  │   mdk   │ │
              │ └───────────┘ └──────────────┘  └─────────┘ │
              └────────────┬────────────────────────────────┘
                           │
                           ▼
                ┌────────────────────────────────────┐
                │   FASTAPI (PYTHON)                 │
                │   port 8001                        │
                │ ┌────────────────────────────────┐ │
                │ │ /process-stream    (SSE)       │ │
                │ │ /do-verify                     │ │
                │ │ /verdict/{id}                  │ │
                │ │ /transactions-summary          │ │
                │ │ /health                        │ │
                │ └─────┬─────┬──────┬─────────────┘ │
                └───────┼─────┼──────┼───────────────┘
                        │     │      │
              ┌─────────▼─┐ ┌─▼──┐ ┌─▼────────┐
              │ OpenAI    │ │Tav-│ │ Supabase │
              │ GPT-4o    │ │ily │ │ Postgres │
              └───────────┘ └────┘ └──────────┘

                           │  every paid endpoint shells out to:
                           ▼
              ┌────────────────────────────────────┐
              │  MDK AGENT WALLET (LDK Node)       │
              │  daemon on localhost:3456          │
              │  HTTP API: /balance /payments /…   │
              │  CLI: npx @moneydevkit/agent-wallet│
              └─────────────┬──────────────────────┘
                            │
                            │  Bitcoin Lightning Network
                            ▼
              ┌────────────────────────────────────┐
              │   lsp.moneydevkit.com:9735 (LSP)   │
              │   LSPS4 BOLT12 receive support     │
              └─────────────┬──────────────────────┘
                            │
       ┌────────────────────┼────────────────────┐
       │                                         │
┌──────▼──────┐                          ┌───────▼──────────┐
│ Your Phoenix│  (funds MDK once)        │ Doctor's Phoenix │
│   (mobile)  │                          │ (receives BOLT12 │
└─────────────┘                          │  per verdict)    │
                                         └──────────────────┘
```

### 3.2 The three-tier Lightning waterfall (per high-stakes query)

```
Browser                Next.js                FastAPI              MDK            Doctor
   │                      │                      │                  │              │
   │── question ─────────►│                      │                  │              │
   │                      │── /process-stream ──►│                  │              │
   │◄── classify, ───────┤                      │                  │              │
   │   confidence,        │                      │                  │              │
   │   tier_eval,         │                      │                  │              │
   │   tier_selected,     │                      │                  │              │
   │   drafting,          │                      │                  │              │
   │   needs_verification ├──────────────────────┘                  │              │
   │                      │                                         │              │
   │                      │── POST /api/triage ─────────────────────►              │
   │                      │◄── 402 + invoice (1 sat) ──────────────                │
   │                      │── npx send (1 sat) ────────────────────►│              │
   │                      │                                         │── 1 sat ────►│ (*)
   │                      │── POST /api/triage + L402 hdr ─────────►│              │
   │                      │◄── { escalate: true, reason, conf } ───                │
   │◄── triage_complete ──┤                                         │              │
   │                      │                                         │              │
   │                      │── POST /api/verify ─────────────────────►              │
   │                      │◄── 402 + invoice (2 sats) ─────────────                │
   │                      │── npx send (2 sats) ───────────────────►│              │
   │                      │                                         │── 2 sats ──►│ (*)
   │                      │── POST /api/verify + L402 hdr ─────────►│              │
   │                      │   (settle)                              │              │
   │                      │── /do-verify ───────────────────────────►│              │
   │                      │                       │                 │              │
   │                      │       (verdict generation: GPT-4o expert persona +     │
   │                      │        Tavily fact-check, signed Ed25519, ~10s)        │
   │                      │                       │                 │              │
   │                      │                       │── pay_expert ──►│              │
   │                      │                       │                 │── 2 sats ───►│
   │                      │                       │                 │              │
   │                      │── /verdict/{id} ──────►│ (poll until resolved)         │
   │                      │◄── verdict + receipt ─                  │              │
   │◄── verified event ───┤                       │                 │              │
   │   (with receipt)     │                       │                 │              │

(*) goes to MDK cloud's account, not Doctor — Vouch's "revenue" leg
```

**Three Lightning payments per query:**

| Leg | From → To | Amount | Purpose |
|---|---|---|---|
| Agent → Triage | MDK → MDK cloud (Vouch's triage account) | **1 sat** | Cheap AI second opinion before committing to expensive human review (agent-to-agent commerce) |
| Agent → Vouch | MDK → MDK cloud (Vouch's verify account) | **2 sats** | Marketplace access fee (L402 paywall — payment IS the auth) |
| Vouch → Doctor | MDK → Doctor's Phoenix BOLT12 offer | **2 sats** | Doctor compensation for verdict |

Total per query: **~5 sats (~$0.05)**. Stripe could not process the L402 leg at $0.02 — its $0.30 minimum exceeds the entire transaction value by 15×.

### 3.3 Streaming reasoning (SSE)

The frontend chat route (`/api/chat`) is itself a Server-Sent Events endpoint that proxies the backend's `/process-stream` and *adds* the L402 payment events inline. The browser receives the entire reasoning trace in real time:

```
data: {"step":"thinking","message":"Analyzing question..."}
data: {"step":"classify","domain":"healthcare","domain_label":"medical","subspecialty":"Dermatology","stakes_level":"high"}
data: {"step":"confidence","value":0.65,"reasoning":"..."}
data: {"step":"tier_eval","options":[{"tier":"triage","sats":2,...},...]}
data: {"step":"tier_selected","tier":"triage","sats":2,"subspecialty":"Dermatology","reason":"..."}
data: {"step":"drafting","message":"Drafting answer for expert review..."}
data: {"step":"needs_verification","draft":"...","subspecialty":"Dermatology","request_id":"a1b2c3d4"}

# === injected by frontend SSE proxy from this point ===
data: {"step":"triage_paying","sats":1,"price_dollars":0.01}
data: {"step":"payment_settled","preimage":"abc123...","sats":1}
data: {"step":"triage_complete","escalate":true,"reason":"...","confidence":0.78}
data: {"step":"paying","sats":2,"price_dollars":0.02}
data: {"step":"payment_settled","preimage":"def456...","sats":2}
data: {"step":"verifier_notified"}
data: {"step":"verified","answer":"...","expert_verdict":"...","signature":"...","public_key":"...","signed_payload":{...}}
```

Each event maps to a row in the chat UI's reasoning panel — the user sees the agent's WHEN/WHO/HOW MUCH decisions live, including each Lightning payment as it fires. The wallet widget in the header decrements per `payment_settled` event.

### 3.4 Cryptographic verification receipts

Every verdict is signed by the verifier's **Ed25519 private key**. The signed payload commits to:

```json
{
  "version": "vouch-receipt-v1",
  "request_id": "a1b2c3d4",
  "question_hash": "sha256(question)",
  "ai_draft_hash": "sha256(ai_draft)",
  "verdict_hash": "sha256(expert_verdict)",
  "verifier_id": "uuid",
  "verifier_name": "Dr. Sarah Chen",
  "license_attestation": "California Medical Board · License #G123456 · NPI #1234567890",
  "tier": "triage",
  "sats_paid": 2,
  "payment_preimage": "cef2ba8e89697ca8...",
  "timestamp": "2026-04-26T03:12:31.000Z"
}
```

Canonical JSON serialization (sort_keys, no spaces, `ensure_ascii=False`) — Python and JS produce byte-identical output. The signature is verifiable client-side via WebCrypto:

```typescript
const key = await crypto.subtle.importKey("raw", publicKeyBytes, { name: "Ed25519" }, false, ["verify"]);
const valid = await crypto.subtle.verify("Ed25519", key, signatureBytes, canonicalBytes);
```

**Why this matters:** in a real malpractice scenario, the receipt is a tamper-evident audit trail — the patient holds proof that a specific licensed verifier reviewed a specific draft answer and was paid a specific amount via a specific Lightning preimage. No trust in Vouch required to verify.

### 3.5 The triage agent (agent-to-agent commerce)

Before paying the expensive human verification leg, the agent calls our **Triage Agent** — a separate LLM-as-a-service that gives a yes/no on whether human review is actually warranted. This costs **1 sat**, settles in <1 second, and demonstrates the brief's "agent-to-agent" angle.

The triage agent (`/api/triage`) is itself L402-paywalled. The merchant agent does the L402 dance, pays, and gets back:

```json
{ "escalate": true, "reason": "Pediatric dosing requires clinician verification", "confidence": 0.78, "preimage": "..." }
```

If `escalate: false`, the AI draft is shipped directly — no human paid, no 2-sat L402 fired, no expert payout. The agent visibly makes a *commercial decision* per question: spend $0 on the AI draft, $0.01 on the triage agent, then conditionally $0.04 on the human chain. **This is WHEN/WHO/HOW MUCH made literal**, with two distinct Lightning payments per query proving each decision.

### 3.6 Dynamic specialty routing

Stakes detection (GPT-4o, JSON-mode) returns:

```json
{
  "needs_verification": true,
  "confidence": 0.65,
  "domain": "healthcare",
  "subspecialty": "Dermatology",
  "reasoning": "Topical antifungal selection requires clinician judgment based on lesion presentation"
}
```

The `subspecialty` field is free-text from the LLM (Dermatology / Cardiology / Tax Law / Estate Planning / etc.) and propagates through the SSE stream into the UI ("Routing to Dermatology specialist…") and into the expert persona used at verdict generation:

```python
persona["title"] = f"Board-Certified {subspecialty} Specialist"
persona["credentials"] = f"MD {subspecialty}, Stanford 2014 · 9 yrs experience"
```

So Dr. Sarah Chen reviews a fungal infection question as a *Dermatology Specialist*, not as a generic internist. The verdict text is contextually correct for the subspecialty.

### 3.7 Tavily fact-check pipeline

Before generating the verdict, the backend calls Tavily Search to retrieve 3 authoritative sources for the user's question. The sources + Tavily's extracted answer are embedded in the GPT-4o expert prompt, so the verdict is grounded in real web facts, not just the model's parametric knowledge:

```python
fact_check = await tavily_fact_check(question, ai_draft)
# → { "tavily_answer": "...", "sources": [{title, url, snippet}, ...] }

verdict_obj = await generate_expert_verdict(
    question=question,
    ai_draft=ai_draft,
    domain=domain,
    subspecialty=subspecialty,
    fact_check=fact_check,
)
```

The expert persona prompt receives the Tavily summary + source titles + snippets as additional context, then writes a 80–150 word first-person response with the authority of cited evidence baked in.

---

## 4 · Per-query lifecycle (full money trace)

A single high-stakes query, end to end:

```
T+0    User types "How much paracetamol can a 25kg child take per dose?"
T+0.1  POST /api/chat (SSE stream opens)
T+0.2  Frontend → backend POST /process-stream
T+0.5  Backend GPT-4o: detect_stakes
        → { domain: "healthcare", subspecialty: "Pediatrics", confidence: 0.65 }
T+0.8  SSE: classify, confidence, tier_eval, tier_selected
T+1.2  Backend GPT-4o: generate_draft
T+3.5  SSE: needs_verification (with draft, request_id)
T+3.6  Frontend SSE proxy captures verifyCtx, opens triage L402 dance
T+3.7  POST /api/triage → 402 + invoice (1 sat)
T+3.8  Frontend execs `npx @moneydevkit/agent-wallet send <invoice>`
T+5.5  MDK Lightning routes → LSP → MDK cloud account · ~1.7s
T+5.6  POST /api/triage + L402 macaroon:preimage header
T+5.7  /api/triage handler: settle() → GPT-4o-mini → returns { escalate: true }
T+6.5  SSE: triage_complete
T+6.6  Frontend opens verify L402 dance
T+6.7  POST /api/verify → 402 + invoice (2 sats)
T+6.8  Frontend execs npx send (2 sats)
T+8.5  MDK Lightning routes → LSP → MDK cloud · ~1.7s
T+8.6  POST /api/verify + L402 header
T+8.7  /api/verify handler: settle() → calls backend /do-verify
T+8.8  Backend /do-verify writes verification_requests row, schedules
        asyncio.create_task(simulate_expert_response(request_id, domain, subspecialty))
T+8.9  Backend returns request_id, verify route polls /verdict/{id} every 2s
T+8.9  Background task sleeps 8s (simulates expert thinking time)
T+10   Frontend wallet widget shows balance ticked down by 3 sats
T+16.9 Background task wakes, attempts atomic claim:
        UPDATE verification_requests SET status='claimed' WHERE id=? AND status='pending'
        ← only one task wins, others exit silently (idempotency guard)
T+17   Background task fetches question + ai_draft from row
T+17.1 Calls tavily_fact_check(question, ai_draft) → 3 sources, Tavily answer
T+18.5 Calls generate_expert_verdict(question, ai_draft, "healthcare", "Pediatrics", fact_check)
T+22   GPT-4o returns 387-char verdict in Dr. Chen's voice with cited sources
T+22.1 Saves verdict to verification_requests row
T+22.2 Calls pay_expert(expert.lightning_address)
        → npx @moneydevkit/agent-wallet send <BOLT12 offer> 2
T+24   MDK routes 2 sats to doctor's Phoenix · ⚡ doctor's phone buzzes
T+24.1 Verify route's verdict poll succeeds, fetches verification row
T+24.2 ensure_keypair(expert_id) — generates Ed25519 keys on first use
T+24.3 build_payload + sign_payload → signature, signed_payload
T+24.4 Persists signature/signed_payload to DB
T+24.5 Returns to frontend chat route
T+24.6 SSE: verified (with verdict, signature, public_key, signed_payload)
T+24.7 Browser renders verified card; receipt modal available on click
T+24.8 Browser WebCrypto verifies Ed25519 signature client-side → green checkmark

Total: ~25s, 5 sats out of agent wallet, doctor receives 2 sats, fully audited.
```

---

## 5 · Key design decisions

### 5.1 Why L402, not Stripe / API keys
Cards fundamentally assume a *human* cardholder. They require KYC, ToS acceptance, billing addresses, 3DS challenges. L402 makes the Lightning payment itself the authentication: agent posts request → server returns 402 + invoice + macaroon → agent pays → presents `Authorization: L402 macaroon:preimage` → access granted. **Stateless, identity-less, programmatic.** The only payment protocol that natively fits autonomous agents.

### 5.2 Why BOLT12 offers, not Lightning Addresses
BOLT12 offers (`lno1...`) are static reusable destinations supported natively by Phoenix without depending on a custodial Lightning Address provider (Cash App, WoS, Alby). Doctors keep their own Lightning wallet on their own phone, give us one offer string, and receive forever — no account on Vouch, no KYC, no platform onboarding. Self-custodial expert supply at scale.

### 5.3 Why Ed25519 receipts, not platform-only verification
The malpractice audit trail can't depend on Vouch surviving. Ed25519 is fast, has small keys (32 bytes pub, 64 bytes sig), is supported natively by browsers (WebCrypto) and by Python (`cryptography`), and produces deterministic signatures. Anyone can verify a receipt against the verifier's pubkey — independent of Vouch — for as long as the patient holds the receipt.

### 5.4 Why a triage agent (agent-to-agent leg)
The strategy brief specifically asks for a demonstration of the agent making a per-query commercial decision. A triage agent (1-sat AI second opinion before the 2-sat human review) makes the WHEN/WHO/HOW MUCH framework literal: the agent visibly evaluates whether escalation is worth it, and pays a separate AI service for that judgment. Three Lightning payments per query, each with a distinct economic role.

### 5.5 Why Tavily for fact-check
Pre-trained LLM knowledge has a cutoff and hallucinates on specific medical/legal/financial details. Tavily provides real-time authoritative web sources per question that ground the expert verdict. The verdict text references real, current sources (e.g., AAP guidelines, IRS publications) that the LLM alone might get wrong.

### 5.6 Why dynamic specialty routing
A single hardcoded "Pediatrics" specialty was wrong for a fungal infection question. The stakes classifier already runs once per query — we extended it to also detect a free-text subspecialty, then dynamically rewrite the expert persona's title and credentials. One LLM call, one extra field, no extra latency. Specialist-appropriate verdicts per question.

### 5.7 Why DEMO_MODE (idempotent simulator)
Real demo recording can't depend on a human typing verdicts in Telegram during a live take. DEMO_MODE simulates an expert response after an 8-second sleep using the same `pay_expert()` payout path as real Telegram-typed verdicts. Real Lightning still fires; the only thing simulated is the verdict text generation (which is the contextual GPT-4o + Tavily output, not the canned text it used to be).

The idempotent atomic claim prevents the race where multiple `/do-verify` calls (e.g., on L402 retry or browser reconnect) queue duplicate simulator tasks and double-pay the expert. Postgres `UPDATE … WHERE status='pending'` ensures only one task wins.

---

## 6 · Repository layout

```
D:\Projects\MIT-Hackathon-2026-C02\
├── README.md                     ← Original CONSILIUM README (predecessor)
├── TECH.md                       ← This file
├── frontend/                     ← Next.js 16 app
│   ├── package.json
│   ├── next.config.ts            ← MDK plugin wiring
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx          ← VitalsAI consumer chat (~600 lines)
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx      ← Vouch admin dashboard
│   │   │   ├── globals.css
│   │   │   └── api/
│   │   │       ├── chat/route.ts          ← SSE proxy + L402 dance for triage + verify
│   │   │       ├── triage/route.ts        ← L402:1 sat — GPT-4o-mini second opinion
│   │   │       ├── verify/route.ts        ← L402:2 sats — calls backend /do-verify
│   │   │       ├── wallet/route.ts        ← MDK balance proxy
│   │   │       ├── wallet/transactions/route.ts  ← MDK payments history
│   │   │       ├── wallet/receive/route.ts       ← Generates BOLT12 offer for incoming
│   │   │       ├── experts/balances/route.ts     ← Per-expert payout aggregation
│   │   │       ├── webhooks/mdk/route.ts         ← MDK cloud webhook receiver
│   │   │       └── mdk/route.ts                  ← MDK SDK catch-all route
│   │   ├── components/ui/        ← shadcn (button, card, badge, etc.)
│   │   └── lib/
│   │       ├── utils.ts
│   │       └── receipt.ts        ← Ed25519 client-side verification, canonical JSON
│   └── .env                      ← MDK_API_KEY, MDK_WEBHOOK_SECRET, NEXT_PUBLIC_APP_URL, OPENAI_API_KEY, FASTAPI_URL
├── backend/                      ← FastAPI app
│   ├── main.py                   ← Process stream, do-verify, verdict, transactions-summary
│   ├── llm.py                    ← Stakes classifier, draft, expert persona + verdict
│   ├── tavily.py                 ← Tavily fact-check call
│   ├── signing.py                ← Ed25519 keypair gen + sign + canonical JSON
│   ├── payouts.py                ← MDK CLI shell-out for expert payouts
│   ├── supabase_client.py        ← Supabase REST client
│   ├── telegram_bot.py           ← (legacy / disabled when TELEGRAM_ENABLED=false)
│   ├── requirements.txt          ← fastapi, uvicorn, openai, supabase, cryptography, httpx
│   ├── supabase/
│   │   ├── 001_initial.sql       ← experts, verification_requests, chat_sessions
│   │   ├── 002_seed_experts.sql  ← Dr. Sarah Chen, Atty. Marcus Johnson, Jennifer Park
│   │   ├── 003_signing.sql       ← public_key, private_key, signature, signed_payload, etc.
│   │   └── 004_seed_keys.sql     ← License attestations + American identities
│   ├── venv/                     ← Python virtualenv
│   └── .env                      ← SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY, TAVILY_API_KEY
└── scripts/
    ├── browser_test.mjs          ← Headed/headless puppeteer-core walkthrough
    └── screenshots/              ← Test screenshots
```

---

## 7 · Local development

### 7.1 Prerequisites
- **Node.js 18+** with `npm`
- **Python 3.11+**
- **Phoenix wallet** on your phone with mainnet sats (~$5 worth covers extensive testing)
- **A second Phoenix wallet** on a friend's phone for the doctor receive side
- **Supabase project** with REST API
- **OpenAI API key** (`sk-...`)
- **Tavily API key** (free tier: https://tavily.com)
- **MoneyDevKit account + API key** (https://dashboard.moneydevkit.com)

### 7.2 First-time setup

```bash
# 1. Clone & install
git clone <repo>
cd MIT-Hackathon-2026-C02

# 2. Frontend
cd frontend
npm install

# 3. Backend
cd ../backend
python -m venv venv
venv/Scripts/activate          # Windows
# source venv/bin/activate     # macOS/Linux
pip install -r requirements.txt

# 4. Supabase migrations — paste each SQL file into Supabase SQL editor in order:
#    backend/supabase/001_initial.sql
#    backend/supabase/002_seed_experts.sql
#    backend/supabase/003_signing.sql
#    backend/supabase/004_seed_keys.sql

# 5. MDK Agent Wallet (one-time on the laptop)
npx @moneydevkit/agent-wallet@latest init
# SAVE THE 12-WORD MNEMONIC OUTPUT — only backup of the wallet
```

### 7.3 Configure env vars

**`frontend/.env`:**
```env
FASTAPI_URL=http://localhost:8001
NEXT_PUBLIC_APP_URL=http://localhost:3001        # or your dev tunnel URL
SKIP_LIGHTNING=false
OPENAI_API_KEY=sk-...
MDK_API_KEY=...
MDK_WEBHOOK_SECRET=...
```

**`backend/.env`:**
```env
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
OPENAI_API_KEY=sk-...
TAVILY_API_KEY=tvly-...
TELEGRAM_ENABLED=false
DEMO_MODE=true
PAYOUT_AMOUNT_SATS=2
PORT=8001
```

### 7.4 Fund the agent wallet

```bash
# Generate a receive invoice (~5000 sats covers ~1000 demo runs at 5 sats/query)
npx @moneydevkit/agent-wallet@latest receive 5000
# → prints lnbc... invoice

# Pay it from Phoenix on your phone (Send → paste → confirm)

# Verify
npx @moneydevkit/agent-wallet@latest balance
# → {"balance_sats": 5000}
```

**First-receive note:** the LSP charges a JIT channel-open fee (~150 sats) on the *very first* incoming payment, then channel stays open and future receives are fee-less. Budget ~300 sats above your target for the first funding.

### 7.5 Wire your friend's BOLT12 offer

Friend on their phone: open Phoenix → Receive → tap reusable QR → copy the `lno1...` (or `bitcoin:?lno=lno1...`) string → send it to you.

You in Supabase Studio → SQL Editor:
```sql
UPDATE experts
SET lightning_address = 'PASTE_FRIENDS_OFFER_HERE'
WHERE name = 'Dr. Sarah Chen';
```

Backend automatically strips the `bitcoin:?lno=` BIP21 prefix.

### 7.6 Run

Three processes — three terminals:

```bash
# Terminal 1 — backend
cd backend
venv/Scripts/python -m uvicorn main:app --port 8001 --reload

# Terminal 2 — frontend
cd frontend
npm run dev
# → http://localhost:3001

# Terminal 3 — MDK daemon (auto-starts on first CLI call, but you can verify)
npx @moneydevkit/agent-wallet@latest status
# → {"running": true, "pid": ..., "port": 3456}
```

### 7.7 Public tunnel (for MDK webhook in dev)

The MDK SDK calls back to your `/api/webhooks/mdk` endpoint when invoices settle. For this to work in local dev, expose port 3001 via a public HTTPS URL.

In VS Code: bottom panel → **Ports** → Forward Port → 3001 → Visibility: **Public** → copy the URL.

Then on the MDK dashboard (https://dashboard.moneydevkit.com), set the app URL to the tunnel URL.

### 7.8 Test the full flow

Open `http://localhost:3001`. Click the high-stakes suggestion ("toe fungal infection"). Watch:

1. Browser: reasoning panel streams in real time
2. Wallet widget: ticks down ~5 sats over 25 seconds
3. Backend terminal: `🔎 [TAVILY]` → `🩺 [VERDICT]` → `💸 [SATS-OUT]` → `✅ [SATS-OUT] SENT 2 sats`
4. Friend's Phoenix: notification — *"Received 2 sats"*
5. View Vouch Receipt: green "Signature valid" + real Lightning preimage

Open `http://localhost:3001/dashboard` in a second tab to see live transactions feed + per-expert balances.

---

## 8 · Deployment notes

For the hackathon judging, the recommended deploy is the **VS Code dev tunnel + laptop** combination — everything runs locally, public HTTPS URL via tunnel, real Lightning over mainnet, real signed receipts.

**Why not full cloud deploy?** The MDK agent wallet is a self-custodial Lightning node with a seed phrase, an open channel, and channel state on disk. Migrating it to a Fly.io / Railway VM means rebuilding all of that on a new node, re-funding from scratch, and managing channel state across deploys. For a 24-hour judging window this is more risk than reward. Vercel could host the frontend pointing at the laptop tunnel for backend, which gives a clean pitch URL (`vouch.vercel.app`) without the cloud-Lightning rebuild — that's the pragmatic middle path.

**Production architecture (post-hackathon):**
- Frontend on Vercel / Cloudflare Pages
- Backend on Fly.io / Railway with persistent volume for Supabase pooler
- MDK Agent Wallet on a Fly.io VM with mounted volume for `~/.mdk-wallet/`
- Supabase already cloud-native
- L402 webhook handler on Vercel calls back to backend via internal URL

---

## 9 · Known limitations

| Area | Current state | Production gap |
|---|---|---|
| Expert reputation | None — all experts equal | Need: approval rate, dispute rate, response time, slashing |
| Cold start | DEMO_MODE simulates verdicts | Need: real expert pool with on-call rotation |
| Multi-merchant routing | Single VitalsAI surface | Need: SDK distribution to multiple AI products |
| Wallet recovery | Local mnemonic in `~/.mdk-wallet/config.json` | Need: encrypted backup, recovery flow, multisig |
| Telegram disabled | DEMO_MODE only | Real verifiers would use Telegram or custom verifier UI |
| Fixed pricing | 1/2/2 sats hardcoded | Need: stake-based dynamic pricing, expert bidding |
| Single LSP | All routing via lsp.moneydevkit.com | Need: multiple LSP fallback for resilience |

---

## 10 · Spiral evaluation criteria mapping

| Spiral criterion | How Vouch delivers |
|---|---|
| **Novel and valuable — agents pay for it** | Verification is on Spiral's "things agents will pay for" list; the marketplace shape gives agents a single endpoint per vertical |
| **Money actually moves** | Three real Lightning payments per query, real preimages, real BOLT12 routing to friend's Phoenix on a separate device — verifiable in MDK payment history |
| **Trust, safety, scale** | Ed25519 signed receipts (audit trail), license attestations on every verdict, atomic claim idempotency (no double-payouts), multi-tier escalation (cheap AI before expensive human) |
| **Lightning use** | Three structurally distinct uses: L402 paywall (auth), agent-to-agent micropayment (1 sat to triage), permissionless expert payout (BOLT12 to Phoenix) |
| **Bonus: Lightning enables what cards can't** | (1) account-less agent authentication via L402, (2) sub-cent micropayments at 0% fees, (3) self-custodial cross-border expert supply with no Stripe Connect / W-9 / banking onboarding |

---

*Built in 18 hours of focused work. Real Lightning, real Ed25519 signatures, real Tavily fact-checks. Lightning isn't tacked on. It's the only rail that makes the agent economy real.*
