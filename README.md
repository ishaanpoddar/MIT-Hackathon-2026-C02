# Agent Verification Marketplace

Built for MIT Hackathon — Challenge 02 (Earn in the Agent Economy).

An LLM-facing API where AI agents autonomously call human experts to verify high-stakes answers, paying sub-dollar fees per request via the Lightning Network. Cross-border, agent-initiated, settles in seconds.

## Repo layout

- `telegram/` — Verifier bot. FastAPI service that turns an HTTP `/verify` call into a Telegram message to a human expert, captures their reply, and returns it.
- `backend/` — Agent backend (in development). Hosts the LLM agent, decides when to verify, and integrates the Lightning paywall.
- `frontend/` — User-facing interface (in development).

## Quick start (verifier bot)

Setup steps are in the docstring at the top of `telegram/verifier_bot.py`.

## Architecture

User asks question, LLM agent drafts an answer, then runs a confidence check. If uncertain, the agent calls the verifier API. Lightning payment goes out via L402, a human verifier is paged via Telegram, the reply comes back, and the final answer is rendered with a verification receipt.
