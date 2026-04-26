"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar } from "@/components/ui/avatar";
import {
  Send,
  ShieldCheck,
  Loader2,
  Bot,
  User,
  Stethoscope,
  Zap,
  Receipt,
  X,
  CheckCircle2,
  Circle,
  Brain,
  AlertCircle,
  RefreshCw,
  LayoutDashboard,
  ExternalLink,
} from "lucide-react";
import { verifyReceipt, shortHash } from "@/lib/receipt";

type StreamEvent = {
  step: string;
  [key: string]: unknown;
};

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  events: StreamEvent[];
  type?: "direct" | "verified" | "verified_fallback";
  expert_verdict?: string;
  expert_name?: string;
  expert_credentials?: string;
  license_attestation?: string;
  request_id?: string;
  latency_seconds?: number;
  signature?: string;
  public_key?: string;
  signed_payload?: Record<string, unknown>;
  sats_paid?: number;
  price_dollars?: number;
  domain?: string;
  isStreaming?: boolean;
  verification_failed?: boolean;
}

const DEMO_DOLLARS_PER_100_SATS = 1;
const DEMO_FUND_TARGET_SATS = 10000;

function formatDollars(sats: number): string {
  const dollars = (sats / 100) * DEMO_DOLLARS_PER_100_SATS;
  return `$${dollars.toFixed(2)}`;
}

export default function VitalsAIPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [walletSats, setWalletSats] = useState<number | null>(null);
  const [walletStatus, setWalletStatus] = useState<"loading" | "ok" | "unavailable">("loading");
  const [receiptOpenId, setReceiptOpenId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchWallet = useCallback(async () => {
    try {
      const res = await fetch("/api/wallet");
      const data = await res.json();
      if (data.unavailable) {
        setWalletStatus("unavailable");
        setWalletSats(null);
      } else {
        setWalletSats(data.sats || 0);
        setWalletStatus("ok");
      }
    } catch {
      setWalletStatus("unavailable");
    }
  }, []);

  useEffect(() => {
    fetchWallet();
  }, [fetchWallet]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      events: [],
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        events: [],
        isStreaming: true,
      },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, session_id: "demo" }),
      });

      if (!res.ok || !res.body) {
        throw new Error("Stream failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";

        for (const block of blocks) {
          if (!block.startsWith("data: ")) continue;
          const json = block.slice(6).trim();
          if (!json) continue;

          let evt: StreamEvent;
          try {
            evt = JSON.parse(json);
          } catch {
            continue;
          }

          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantId) return m;
              const events = [...m.events, evt];
              const update: Partial<ChatMessage> = { events };

              if (evt.step === "answer") {
                update.content = String(evt.answer || "");
                update.type = "direct";
                update.isStreaming = false;
              } else if (evt.step === "verified") {
                update.content = String(evt.answer || "");
                update.type = "verified";
                update.expert_verdict = String(evt.expert_verdict || "");
                update.expert_name = String(evt.expert_name || "");
                update.expert_credentials = String(evt.expert_credentials || "");
                update.license_attestation = String(evt.license_attestation || "");
                update.request_id = String(evt.request_id || "");
                update.latency_seconds = Number(evt.latency_seconds || 0);
                update.signature = String(evt.signature || "");
                update.public_key = String(evt.public_key || "");
                update.signed_payload = (evt.signed_payload || {}) as Record<string, unknown>;
                update.sats_paid = Number(evt.sats_paid || 0);
                update.price_dollars = Number(evt.price_dollars || 0);
                update.domain = String(evt.domain || "");
                update.isStreaming = false;
              } else if (evt.step === "verified_fallback") {
                update.content = String(evt.draft || "");
                update.type = "verified_fallback";
                update.verification_failed = true;
                update.isStreaming = false;
              } else if (evt.step === "payment_settled" || evt.step === "paying") {
                if (typeof evt.sats === "number" && walletSats !== null) {
                  setWalletSats((s) => (s !== null ? Math.max(0, s - (evt.sats as number)) : s));
                }
              } else if (evt.step === "error") {
                update.content = "Something went wrong. Please try again.";
                update.isStreaming = false;
              }

              return { ...m, ...update };
            })
          );
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: "Network error. Please try again.", isStreaming: false }
            : m
        )
      );
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
      setTimeout(fetchWallet, 1500);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const openReceipt = messages.find((m) => m.id === receiptOpenId);

  return (
    <div className="flex flex-col h-screen bg-gradient-to-b from-sky-50/40 via-white to-white">
      <header className="border-b border-sky-100 bg-white/80 backdrop-blur px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-sky-500 to-teal-500 flex items-center justify-center shadow-sm">
            <Stethoscope className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight">VitalsAI</h1>
            <p className="text-xs text-muted-foreground -mt-0.5">
              Telehealth Assistant
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition-colors"
            title="Open Vouch admin dashboard in a new tab"
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            Vouch Dashboard
            <ExternalLink className="h-3 w-3 opacity-60" />
          </a>
          <WalletWidget
            sats={walletSats}
            status={walletStatus}
            onRefresh={fetchWallet}
          />
        </div>
      </header>

      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="max-w-3xl mx-auto space-y-6 pb-4">
          {messages.length === 0 && (
            <EmptyState
              onPick={(s) => {
                setInput(s);
                inputRef.current?.focus();
              }}
            />
          )}

          {messages.map((msg) => (
            <MessageView
              key={msg.id}
              msg={msg}
              onOpenReceipt={() => setReceiptOpenId(msg.id)}
            />
          ))}
        </div>
      </ScrollArea>

      <div className="border-t bg-white px-4 py-3">
        <div className="max-w-3xl mx-auto flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your symptoms or ask a health question..."
            disabled={isLoading}
            className="flex-1"
          />
          <Button
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
            size="icon"
            className="bg-sky-600 hover:bg-sky-700"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="max-w-3xl mx-auto text-[10px] text-muted-foreground mt-2 text-center">
          VitalsAI is an AI assistant. High-stakes answers are verified by a licensed
          professional via the Vouch network before being shown to you.
        </p>
      </div>

      {openReceipt && openReceipt.signature && (
        <ReceiptModal
          msg={openReceipt}
          onClose={() => setReceiptOpenId(null)}
        />
      )}
    </div>
  );
}

function WalletWidget({
  sats,
  status,
  onRefresh,
}: {
  sats: number | null;
  status: "loading" | "ok" | "unavailable";
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-1.5">
      <Zap className="h-4 w-4 text-amber-500" />
      <div className="text-right leading-tight">
        {status === "loading" && (
          <span className="text-xs text-muted-foreground">Loading wallet…</span>
        )}
        {status === "unavailable" && (
          <span className="text-xs text-muted-foreground">
            Wallet not initialized
          </span>
        )}
        {status === "ok" && sats !== null && (
          <>
            <div className="text-sm font-mono font-semibold tabular-nums">
              {sats.toLocaleString()} sats
            </div>
            <div className="text-[10px] text-muted-foreground tabular-nums">
              ≈ {formatDollars(sats)} · funded {DEMO_FUND_TARGET_SATS.toLocaleString()}
            </div>
          </>
        )}
      </div>
      <button
        onClick={onRefresh}
        className="text-amber-600 hover:text-amber-700"
        title="Refresh wallet balance"
      >
        <RefreshCw className="h-3 w-3" />
      </button>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  const suggestions = [
    {
      text: "What's a normal resting heart rate for adults?",
      tag: "low-stakes · answered directly",
    },
    {
      text: "I have a fungal infection on my toes that hurts a lot — what medicine can I take?",
      tag: "high-stakes · expert verification",
    },
    {
      text: "How much paracetamol can a 75kg adult take per dose?",
      tag: "high-stakes · expert verification",
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-sky-500 to-teal-500 flex items-center justify-center shadow-md mb-4">
        <Stethoscope className="h-7 w-7 text-white" />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight mb-2">
        How can I help today?
      </h2>
      <p className="text-muted-foreground max-w-md text-sm">
        Ask about symptoms, medications, or general health. High-stakes questions
        get verified by a licensed clinician on demand.
      </p>
      <div className="mt-8 w-full max-w-xl space-y-2">
        {suggestions.map((s) => (
          <button
            key={s.text}
            className="block w-full text-left px-4 py-3 rounded-xl border border-sky-100 bg-white hover:border-sky-300 hover:bg-sky-50/40 transition-colors group"
            onClick={() => onPick(s.text)}
          >
            <div className="text-sm">{s.text}</div>
            <div className="text-[10px] text-sky-600/80 mt-1 font-medium uppercase tracking-wide">
              {s.tag}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageView({
  msg,
  onOpenReceipt,
}: {
  msg: ChatMessage;
  onOpenReceipt: () => void;
}) {
  const isUser = msg.role === "user";
  return (
    <div className="flex gap-3">
      <Avatar
        className={`h-8 w-8 flex items-center justify-center rounded-lg border shrink-0 ${
          isUser ? "bg-white" : "bg-gradient-to-br from-sky-500 to-teal-500 border-transparent"
        }`}
      >
        {isUser ? (
          <User className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Stethoscope className="h-4 w-4 text-white" />
        )}
      </Avatar>
      <div className="flex-1 space-y-2 min-w-0">
        <p className="text-xs font-medium text-muted-foreground">
          {isUser ? "You" : "VitalsAI"}
        </p>

        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
        ) : (
          <>
            {msg.events.length > 0 && <ReasoningPanel events={msg.events} streaming={msg.isStreaming} />}

            {msg.type !== "verified" && msg.content && (
              <div className="pt-1">
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              </div>
            )}

            {msg.type === "verified" && msg.expert_verdict && (
              <Card className="mt-3 p-0 border-sky-200 bg-white overflow-hidden shadow-sm">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-sky-50 to-teal-50 border-b border-sky-100 flex-wrap">
                  <div className="h-7 w-7 rounded-full bg-gradient-to-br from-sky-600 to-indigo-600 flex items-center justify-center shrink-0">
                    <ShieldCheck className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-semibold text-slate-900">
                        Verified by Licensed Expert
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-600 mt-0.5">
                      Reviewed by a licensed clinician via the Vouch network
                    </p>
                  </div>
                  <Badge className="text-[10px] gap-1 bg-amber-100 text-amber-900 hover:bg-amber-100 border border-amber-200">
                    <Zap className="h-2.5 w-2.5" />
                    {msg.sats_paid ?? 100} sats paid
                  </Badge>
                </div>
                <div className="px-4 py-4">
                  <p className="text-sm whitespace-pre-wrap leading-relaxed text-slate-800">
                    {msg.expert_verdict}
                  </p>
                </div>
                <div className="flex items-center justify-between px-4 py-2 gap-2 flex-wrap border-t border-slate-100 bg-slate-50/40">
                  <p className="text-[11px] text-slate-500">
                    {msg.latency_seconds ? `Response in ${msg.latency_seconds}s` : "Response received"}
                    {msg.sats_paid ? ` · settled over Lightning` : ""}
                  </p>
                  {msg.signature && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onOpenReceipt}
                      className="h-7 text-xs gap-1.5 border-sky-200 hover:bg-sky-100/40"
                    >
                      <Receipt className="h-3 w-3" />
                      View Vouch Receipt
                    </Button>
                  )}
                </div>
              </Card>
            )}

            {msg.verification_failed && (
              <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                Expert verification could not be completed. Showing AI draft only.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ReasoningPanel({
  events,
  streaming,
}: {
  events: StreamEvent[];
  streaming?: boolean;
}) {
  const lines = events
    .map((e) => renderEventLine(e))
    .filter((x): x is { key: string; text: string; sub?: string; tone?: "muted" | "accent" | "warn" } => !!x);

  if (lines.length === 0) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 space-y-1.5">
      <div className="flex items-center gap-1.5 mb-1">
        <Brain className="h-3 w-3 text-slate-500" />
        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
          Agent reasoning
        </span>
      </div>
      <ul className="space-y-1">
        {lines.map((line, i) => {
          const isLast = i === lines.length - 1;
          const showSpinner = streaming && isLast;
          return (
            <li key={line.key + i} className="flex items-start gap-2 text-xs">
              <span className="mt-0.5 shrink-0">
                {showSpinner ? (
                  <Loader2 className="h-3 w-3 animate-spin text-sky-600" />
                ) : (
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                )}
              </span>
              <span className="flex-1">
                <span
                  className={
                    line.tone === "accent"
                      ? "text-sky-700 font-medium"
                      : line.tone === "warn"
                        ? "text-amber-700 font-medium"
                        : "text-slate-700"
                  }
                >
                  {line.text}
                </span>
                {line.sub && (
                  <span className="block text-[10px] text-slate-500 mt-0.5">
                    {line.sub}
                  </span>
                )}
              </span>
            </li>
          );
        })}
        {streaming && lines.length > 0 && (
          <li className="flex items-start gap-2 text-xs">
            <Circle className="h-3 w-3 text-slate-300 mt-0.5" />
            <span className="text-slate-400 italic">Working…</span>
          </li>
        )}
      </ul>
    </div>
  );
}

function renderEventLine(
  e: StreamEvent
):
  | {
      key: string;
      text: string;
      sub?: string;
      tone?: "muted" | "accent" | "warn";
    }
  | null {
  switch (e.step) {
    case "thinking":
      return { key: e.step, text: "Analyzing question…" };
    case "classify":
      return {
        key: e.step,
        text: `Classified: ${e.domain_label || e.domain} · stakes ${e.stakes_level}`,
      };
    case "confidence": {
      const v = typeof e.value === "number" ? Math.round(e.value * 100) : 0;
      return {
        key: e.step,
        text: `Self-confidence: ${v}%`,
        sub: typeof e.reasoning === "string" ? e.reasoning : undefined,
      };
    }
    case "no_escalation":
      return {
        key: e.step,
        text: String(e.message || "High confidence — answering directly, $0 spent."),
        tone: "accent",
      };
    case "tier_eval": {
      const opts = (e.options as Array<Record<string, unknown>>) || [];
      const sub = opts
        .map((o) => `${o.label} ${formatDollars(Number(o.sats || 0))}`)
        .join(" · ");
      return {
        key: e.step,
        text: "Evaluating verification tiers",
        sub,
      };
    }
    case "tier_selected":
      return {
        key: e.step,
        text: `Selected: ${String(e.tier || "")} tier · ${formatDollars(Number(e.sats || 0))}`,
        sub: typeof e.reason === "string" ? e.reason : undefined,
        tone: "accent",
      };
    case "drafting":
      return { key: e.step, text: String(e.message || "Drafting answer…") };
    case "needs_verification":
      return {
        key: e.step,
        text: "Draft ready — escalating to licensed expert",
      };
    case "triage_paying":
      return {
        key: e.step,
        text: `Consulting AI triage agent · paying ${e.sats} sat over Lightning…`,
        sub: "Agent-to-agent: cheap second opinion before paying for human review",
        tone: "accent",
      };
    case "triage_complete":
      return {
        key: e.step,
        text: e.escalate
          ? `Triage agent: escalate to human (confidence ${Math.round(Number(e.confidence || 0) * 100)}%)`
          : `Triage agent: AI draft sufficient — no escalation`,
        sub: typeof e.reason === "string" ? e.reason : undefined,
        tone: "accent",
      };
    case "triage_no_escalation":
      return {
        key: e.step,
        text: String(e.message || "Triage approved AI draft directly"),
        tone: "accent",
      };
    case "paying":
      return {
        key: e.step,
        text: `Paying ${e.sats} sats over Lightning to licensed expert…`,
        tone: "accent",
      };
    case "payment_settled":
      return {
        key: e.step,
        text: "Lightning payment settled",
        sub: typeof e.preimage === "string" ? `preimage ${shortHash(e.preimage)}` : undefined,
        tone: "accent",
      };
    case "verifier_notified":
      return { key: e.step, text: "Routing to on-call expert…" };
    case "verified":
      return {
        key: e.step,
        text: `Verdict received in ${Math.round(Number(e.latency_seconds || 0))}s`,
        tone: "accent",
      };
    case "verified_fallback":
      return {
        key: e.step,
        text: "Verification unavailable — showing AI draft",
        tone: "warn",
      };
    case "error":
      return { key: e.step, text: String(e.message || "Error"), tone: "warn" };
    default:
      return null;
  }
}

function labelForDomain(domain?: string): string {
  switch (domain) {
    case "healthcare":
      return "Pediatrics";
    case "legal":
      return "Legal";
    case "finance":
      return "Finance";
    default:
      return "General";
  }
}

function ReceiptModal({
  msg,
  onClose,
}: {
  msg: ChatMessage;
  onClose: () => void;
}) {
  const [valid, setValid] = useState<boolean | null>(null);
  const [verifying, setVerifying] = useState(false);

  const runVerify = useCallback(async () => {
    if (!msg.signed_payload || !msg.signature || !msg.public_key) return;
    setVerifying(true);
    const ok = await verifyReceipt(msg.signed_payload, msg.signature, msg.public_key);
    setValid(ok);
    setVerifying(false);
  }, [msg.signed_payload, msg.signature, msg.public_key]);

  useEffect(() => {
    runVerify();
  }, [runVerify]);

  const payload = msg.signed_payload || {};
  const fields: Array<[string, string]> = [
    ["Receipt version", String(payload.version || "")],
    ["Request ID", String(payload.request_id || "")],
    ["Question hash", shortHash(String(payload.question_hash || ""), 10)],
    ["Verdict hash", shortHash(String(payload.verdict_hash || ""), 10)],
    ["Verifier ID", shortHash(String(payload.verifier_id || ""), 8)],
    ["License", String(payload.license_attestation || "")],
    ["Tier", String(payload.tier || "")],
    ["Settled", `${payload.sats_paid || 0} sats (${formatDollars(Number(payload.sats_paid || 0))})`],
    ["Payment preimage", shortHash(String(payload.payment_preimage || "—"), 12)],
    ["Timestamp", String(payload.timestamp || "")],
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-sky-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-sky-600 to-indigo-600 flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-sky-700 font-semibold">
                Vouch
              </p>
              <h3 className="text-base font-semibold">Verification Receipt</h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div
            className={`rounded-lg border p-3 flex items-center gap-3 ${
              valid === true
                ? "border-emerald-200 bg-emerald-50/60"
                : valid === false
                  ? "border-red-200 bg-red-50/60"
                  : "border-slate-200 bg-slate-50/60"
            }`}
          >
            {verifying && (
              <Loader2 className="h-5 w-5 text-slate-500 animate-spin" />
            )}
            {!verifying && valid === true && (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            )}
            {!verifying && valid === false && (
              <AlertCircle className="h-5 w-5 text-red-600" />
            )}
            <div className="flex-1">
              <p className="text-sm font-medium">
                {verifying
                  ? "Verifying Ed25519 signature…"
                  : valid === true
                    ? "Signature valid"
                    : valid === false
                      ? "Signature INVALID"
                      : "Signature pending"}
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">
                Verified client-side via WebCrypto · Ed25519
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={runVerify}
              className="h-7 text-xs"
            >
              Re-verify
            </Button>
          </div>

          <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 text-xs">
            {fields.map(([k, v]) => (
              <div key={k} className="flex items-start gap-3 px-3 py-2">
                <span className="text-slate-500 w-32 shrink-0">{k}</span>
                <span className="font-mono text-slate-800 break-all flex-1">
                  {v || "—"}
                </span>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-slate-200 p-3 space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Signature
            </p>
            <p className="font-mono text-[10px] text-slate-700 break-all">
              {msg.signature}
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 p-3 space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Verifier public key
            </p>
            <p className="font-mono text-[10px] text-slate-700 break-all">
              {msg.public_key}
            </p>
          </div>

          <p className="text-[10px] text-slate-500 text-center pt-1">
            This receipt cryptographically attests that a licensed expert reviewed
            the question and the AI draft, and was paid over Lightning. Anyone can
            verify the signature against the verifier&apos;s public key.
          </p>
        </div>
      </div>
    </div>
  );
}
