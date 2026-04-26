"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ShieldCheck,
  Wallet,
  RefreshCw,
  ArrowUpRight,
  ArrowDownLeft,
  Activity,
  Users,
  Zap,
  X,
  Copy,
  CheckCircle2,
  Loader2,
  AlertCircle,
} from "lucide-react";

const DOLLARS_PER_100_SATS = 1;
const POLL_MS = 4000;

function formatDollars(sats: number): string {
  const dollars = (sats / 100) * DOLLARS_PER_100_SATS;
  return `$${dollars.toFixed(2)}`;
}

function formatTime(ts: number): string {
  // MDK timestamps are typically seconds; if it looks like milliseconds, treat as ms
  const ms = ts > 10_000_000_000 ? ts : ts * 1000;
  const d = new Date(ms);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function shortHash(hex: string, n = 6): string {
  if (!hex) return "";
  return hex.length > n * 2 ? `${hex.slice(0, n)}…${hex.slice(-n)}` : hex;
}

function classifyCounterparty(p: Payment): string {
  // best-effort labels
  if (p.direction === "inbound") {
    if (p.amountSats <= 50) return "L402 settlement";
    return "External funding";
  }
  // outbound
  if (p.amountSats > 0 && p.amountSats < 100) return "Expert payout";
  return "Outbound payment";
}

type Payment = {
  paymentHash: string;
  amountSats: number;
  direction: "inbound" | "outbound";
  timestamp: number;
  status: string;
};

type ExpertSummary = {
  id: string;
  name: string;
  specialty: string;
  license_attestation: string;
  total_sats_earned: number;
  verification_count: number;
};

type WalletState = {
  sats: number | null;
  status: "loading" | "ok" | "unavailable";
};

export default function DashboardPage() {
  const [wallet, setWallet] = useState<WalletState>({
    sats: null,
    status: "loading",
  });
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [experts, setExperts] = useState<ExpertSummary[]>([]);
  const [expertsError, setExpertsError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);

  const fetchWallet = useCallback(async () => {
    try {
      const res = await fetch("/api/wallet", { cache: "no-store" });
      const data = await res.json();
      if (data.unavailable) {
        setWallet({ sats: null, status: "unavailable" });
      } else {
        setWallet({ sats: data.sats || 0, status: "ok" });
      }
    } catch {
      setWallet({ sats: null, status: "unavailable" });
    }
  }, []);

  const fetchPayments = useCallback(async () => {
    try {
      const res = await fetch("/api/wallet/transactions", { cache: "no-store" });
      const data = await res.json();
      const list: Payment[] = (data.payments || []).slice();
      list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      setPayments(list.slice(0, 20));
      setPaymentsError(data.error || null);
    } catch (err) {
      setPaymentsError(String(err));
    }
  }, []);

  const fetchExperts = useCallback(async () => {
    try {
      const res = await fetch("/api/experts/balances", { cache: "no-store" });
      const data = await res.json();
      setExperts(data.experts || []);
      setExpertsError(data.error || null);
    } catch (err) {
      setExpertsError(String(err));
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchWallet(), fetchPayments(), fetchExperts()]);
    setLastUpdated(new Date());
  }, [fetchWallet, fetchPayments, fetchExperts]);

  useEffect(() => {
    refreshAll();
    const id = setInterval(refreshAll, POLL_MS);
    return () => clearInterval(id);
  }, [refreshAll]);

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-200 font-sans">
      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-900/40 ring-1 ring-white/10">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-[0.18em] text-slate-100">
                VOUCH
              </h1>
              <p className="text-[11px] text-slate-400 -mt-0.5 flex items-center gap-1.5">
                <span className="relative inline-flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                </span>
                Marketplace Infrastructure · Live
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="hidden sm:inline text-[11px] tabular-nums text-slate-500">
                Updated {lastUpdated.toLocaleTimeString("en-US", { hour12: false })}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={refreshAll}
              className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-slate-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh All
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <WalletBlock
            wallet={wallet}
            onRefresh={fetchWallet}
            onReceive={() => setReceiveOpen(true)}
          />
          <StatsBlock
            walletSats={wallet.sats}
            paymentsCount={payments.length}
            expertsCount={experts.length}
            totalPaidOut={experts.reduce((s, e) => s + e.total_sats_earned, 0)}
          />
        </div>

        <TransactionsBlock payments={payments} error={paymentsError} />

        <ExpertsBlock experts={experts} error={expertsError} />

        <footer className="pt-4 pb-8 text-center text-[11px] text-slate-600">
          Vouch · Lightning-native marketplace for AI-to-expert verification ·
          MIT Hackathon 2026
        </footer>
      </main>

      {receiveOpen && <ReceiveModal onClose={() => setReceiveOpen(false)} />}
    </div>
  );
}

function WalletBlock({
  wallet,
  onRefresh,
  onReceive,
}: {
  wallet: WalletState;
  onRefresh: () => void;
  onReceive: () => void;
}) {
  return (
    <Card className="bg-slate-900/60 ring-1 ring-slate-800 border-0 text-slate-200 p-0 overflow-hidden">
      <div className="px-5 pt-5 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-amber-400" />
          <span className="text-xs uppercase tracking-[0.18em] text-slate-400 font-semibold">
            Agent Wallet
          </span>
        </div>
        <button
          onClick={onRefresh}
          className="text-slate-500 hover:text-slate-200 transition"
          title="Refresh balance"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-5 pb-5">
        {wallet.status === "loading" && (
          <div className="py-6 text-slate-500 text-sm flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading wallet…
          </div>
        )}

        {wallet.status === "unavailable" && (
          <div className="py-6 text-slate-500 text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            Wallet daemon unavailable
          </div>
        )}

        {wallet.status === "ok" && wallet.sats !== null && (
          <>
            <div className="flex items-baseline gap-2 tabular-nums">
              <span className="font-mono text-4xl font-semibold text-slate-50">
                {wallet.sats.toLocaleString()}
              </span>
              <span className="text-slate-400 text-sm">sats</span>
            </div>
            <div className="text-sm text-slate-400 mt-1 tabular-nums">
              ≈ {formatDollars(wallet.sats)} USD
            </div>
          </>
        )}

        <div className="flex gap-2 mt-5">
          <Button
            onClick={onReceive}
            className="bg-gradient-to-br from-indigo-500 to-violet-600 text-white hover:from-indigo-400 hover:to-violet-500 border border-violet-400/20"
            size="sm"
          >
            <ArrowDownLeft className="h-3.5 w-3.5" />
            Receive sats
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>
    </Card>
  );
}

function StatsBlock({
  walletSats,
  paymentsCount,
  expertsCount,
  totalPaidOut,
}: {
  walletSats: number | null;
  paymentsCount: number;
  expertsCount: number;
  totalPaidOut: number;
}) {
  const items = [
    {
      label: "Live txns",
      value: paymentsCount.toLocaleString(),
      sub: "in feed",
      icon: Activity,
      tone: "text-emerald-300",
    },
    {
      label: "Active experts",
      value: expertsCount.toLocaleString(),
      sub: "registered",
      icon: Users,
      tone: "text-sky-300",
    },
    {
      label: "Paid to experts",
      value: totalPaidOut.toLocaleString(),
      sub: `sats · ${formatDollars(totalPaidOut)}`,
      icon: Zap,
      tone: "text-amber-300",
    },
    {
      label: "Float",
      value: walletSats !== null ? walletSats.toLocaleString() : "—",
      sub: "sats on hand",
      icon: Wallet,
      tone: "text-violet-300",
    },
  ];

  return (
    <Card className="bg-slate-900/60 ring-1 ring-slate-800 border-0 text-slate-200 p-0 overflow-hidden">
      <div className="px-5 pt-5 pb-2">
        <span className="text-xs uppercase tracking-[0.18em] text-slate-400 font-semibold">
          Marketplace Stats
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 px-5 pb-5">
        {items.map((it) => (
          <div
            key={it.label}
            className="rounded-lg border border-slate-800 bg-slate-950/50 p-3"
          >
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 uppercase tracking-wider">
              <it.icon className={`h-3 w-3 ${it.tone}`} />
              {it.label}
            </div>
            <div className="font-mono text-lg text-slate-100 mt-1 tabular-nums">
              {it.value}
            </div>
            <div className="text-[11px] text-slate-500 tabular-nums">
              {it.sub}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TransactionsBlock({
  payments,
  error,
}: {
  payments: Payment[];
  error: string | null;
}) {
  return (
    <Card className="bg-slate-900/60 ring-1 ring-slate-800 border-0 text-slate-200 p-0 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-emerald-400" />
          <span className="text-xs uppercase tracking-[0.18em] text-slate-300 font-semibold">
            Live Transactions
          </span>
        </div>
        <span className="text-[11px] text-slate-500 tabular-nums">
          {payments.length} most recent
        </span>
      </div>

      {error && (
        <div className="px-5 py-3 text-xs text-amber-400/90 bg-amber-950/20 border-b border-amber-900/30 flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

      {payments.length === 0 && !error && (
        <div className="px-5 py-12 text-center text-sm text-slate-500">
          No transactions yet. Payments will appear here in real time.
        </div>
      )}

      <ul className="divide-y divide-slate-800/80">
        {payments.map((p) => {
          const incoming = p.direction === "inbound";
          const Arrow = incoming ? ArrowDownLeft : ArrowUpRight;
          const tone = incoming ? "text-emerald-400" : "text-amber-400";
          const ring = incoming
            ? "bg-emerald-500/10 ring-emerald-500/30"
            : "bg-amber-500/10 ring-amber-500/30";
          const sign = incoming ? "+" : "−";
          return (
            <li
              key={p.paymentHash + p.timestamp}
              className="px-5 py-3 flex items-center gap-4 hover:bg-slate-800/30 transition-colors"
            >
              <span className="text-[11px] font-mono text-slate-500 tabular-nums w-20 shrink-0">
                {formatTime(p.timestamp)}
              </span>
              <span
                className={`h-7 w-7 rounded-full ring-1 flex items-center justify-center shrink-0 ${ring}`}
              >
                <Arrow className={`h-3.5 w-3.5 ${tone}`} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-200 truncate">
                  {classifyCounterparty(p)}
                </div>
                <div className="text-[11px] text-slate-500 font-mono truncate">
                  {shortHash(p.paymentHash, 8)}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className={`font-mono text-sm tabular-nums ${tone}`}>
                  {sign}
                  {p.amountSats.toLocaleString()} sats
                </div>
                <div className="text-[11px] text-slate-500 tabular-nums">
                  {sign}
                  {formatDollars(p.amountSats).replace("$", "$")}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ExpertsBlock({
  experts,
  error,
}: {
  experts: ExpertSummary[];
  error: string | null;
}) {
  return (
    <Card className="bg-slate-900/60 ring-1 ring-slate-800 border-0 text-slate-200 p-0 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-sky-400" />
          <span className="text-xs uppercase tracking-[0.18em] text-slate-300 font-semibold">
            Expert Balances · Today
          </span>
        </div>
        <span className="text-[11px] text-slate-500 tabular-nums">
          {experts.length} experts
        </span>
      </div>

      {error && (
        <div className="px-5 py-3 text-xs text-amber-400/90 bg-amber-950/20 border-b border-amber-900/30 flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

      {experts.length === 0 && !error && (
        <div className="px-5 py-12 text-center text-sm text-slate-500">
          No experts loaded.
        </div>
      )}

      <ul className="divide-y divide-slate-800/80">
        {experts.map((e) => (
          <li
            key={e.id}
            className="px-5 py-3 flex items-center gap-4 hover:bg-slate-800/30 transition-colors"
          >
            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-sky-500/40 to-indigo-600/40 ring-1 ring-sky-400/20 flex items-center justify-center shrink-0">
              <span className="text-xs font-semibold text-sky-100">
                {(e.name || "?")
                  .split(" ")
                  .map((n) => n[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </span>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-slate-100 truncate">
                  {e.name || "Unnamed expert"}
                </span>
                {e.specialty && (
                  <Badge
                    variant="secondary"
                    className="bg-sky-500/15 text-sky-200 border border-sky-400/20 text-[10px] uppercase tracking-wider"
                  >
                    {e.specialty}
                  </Badge>
                )}
              </div>
              {e.license_attestation && (
                <div className="text-[11px] text-slate-500 truncate mt-0.5">
                  {e.license_attestation}
                </div>
              )}
            </div>

            <div className="text-right shrink-0">
              <div className="font-mono text-sm text-amber-300 tabular-nums">
                +{e.total_sats_earned.toLocaleString()} sats
              </div>
              <div className="text-[11px] text-slate-500 tabular-nums">
                {e.verification_count} verification
                {e.verification_count === 1 ? "" : "s"} ·{" "}
                {formatDollars(e.total_sats_earned)}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ReceiveModal({ onClose }: { onClose: () => void }) {
  const [offer, setOffer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const generatedOnce = useRef(false);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setOffer(null);
    try {
      const res = await fetch("/api/wallet/receive", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.offer) {
        setError(data.error || "Failed to generate offer");
      } else {
        setOffer(data.offer);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (generatedOnce.current) return;
    generatedOnce.current = true;
    generate();
  }, [generate]);

  const copy = async () => {
    if (!offer) return;
    try {
      await navigator.clipboard.writeText(offer);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  // Build a Google Charts QR URL (no extra deps; works offline-ish for the demo)
  const qrUrl = offer
    ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(
        offer
      )}`
    : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-slate-900 ring-1 ring-slate-700 shadow-2xl text-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center ring-1 ring-white/10">
              <ArrowDownLeft className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-violet-300 font-semibold">
                Vouch
              </p>
              <h3 className="text-base font-semibold text-slate-50">
                Receive sats
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-200 p-1"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-500 text-sm">
              <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
              Generating BOLT12 offer…
              <span className="text-[11px] text-slate-600">
                This can take up to 60s
              </span>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-900/40 bg-red-950/30 p-3 text-sm text-red-300 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex-1 break-all">{error}</div>
            </div>
          )}

          {offer && (
            <>
              <div className="flex justify-center">
                {qrUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qrUrl}
                    alt="BOLT12 offer QR code"
                    width={240}
                    height={240}
                    className="rounded-xl bg-white p-2 ring-1 ring-slate-700"
                  />
                )}
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-semibold">
                    BOLT12 Offer
                  </span>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={copy}
                    className="text-slate-400 hover:text-slate-100 hover:bg-slate-800"
                  >
                    {copied ? (
                      <>
                        <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
                <p className="font-mono text-[10px] text-slate-300 break-all leading-relaxed">
                  {offer}
                </p>
              </div>

              <p className="text-[11px] text-slate-500 text-center">
                Send any amount to this offer. The agent wallet will detect the
                payment and credit your balance.
              </p>
            </>
          )}

          <div className="flex justify-between pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={generate}
              disabled={loading}
              className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-slate-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Regenerate
            </Button>
            <Button
              size="sm"
              onClick={onClose}
              className="bg-slate-800 text-slate-200 hover:bg-slate-700"
            >
              Done
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
