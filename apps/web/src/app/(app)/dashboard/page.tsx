'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useSession } from 'next-auth/react';
import { api } from '@/lib/trpc/client';
import { usePortfolioStore } from '@/lib/stores/portfolio';
import { useBacktestStore } from '@/lib/stores/backtest';
import { slideUp, stagger } from '@/lib/motion';
import type { SavedPortfolio } from '@/lib/storage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || !isFinite(v)) return '—';
  return v.toFixed(digits);
}

const ALGO_LABELS: Record<string, string> = {
  markowitz: 'Markowitz',
  hrp: 'HRP',
  risk_parity: 'Risk Parity',
  cvar: 'CVaR',
  robust: 'Robust MVO',
};

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

function Sparkline({ values, positive }: { values: number[]; positive: boolean }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 64, H = 24;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - ((v - min) / range) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="shrink-0">
      <polyline
        points={pts}
        fill="none"
        stroke={positive ? 'var(--gain)' : 'var(--loss)'}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Quick-action card
// ---------------------------------------------------------------------------

interface ActionCardProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  description: string;
}

function ActionCard({ href, icon, label, description }: ActionCardProps) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 rounded-lg border border-[var(--border)] p-5 transition-colors duration-[var(--duration-fast)] hover:border-[var(--accent)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent)]">
        {icon}
      </div>
      <div>
        <p className="text-[13px] font-medium text-primary mb-0.5">{label}</p>
        <p className="text-[12px] text-muted leading-snug">{description}</p>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Snapshot card
// ---------------------------------------------------------------------------

interface SnapshotCardProps {
  ticker: string;
  price: number;
  change_pct: number;
  sparkline: number[];
}

function SnapshotCard({ ticker, price, change_pct, sparkline }: SnapshotCardProps) {
  const pos = change_pct >= 0;
  return (
    <div className="flex shrink-0 flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4 w-[148px]">
      <div className="flex items-center justify-between">
        <span className="mono text-[11px] font-medium text-primary tracking-wide">{ticker}</span>
        <span className={`mono text-[11px] tabular-nums ${pos ? 'gain' : 'loss'}`}>
          {pos ? '+' : ''}{change_pct.toFixed(2)}%
        </span>
      </div>
      <Sparkline values={sparkline} positive={pos} />
      <span className="mono text-[13px] tabular-nums text-primary">
        {price < 100 ? price.toFixed(2) : price.toFixed(2)}
      </span>
    </div>
  );
}

function SnapshotSkeleton() {
  return (
    <div className="flex shrink-0 flex-col gap-2 rounded-lg border border-[var(--border)] p-4 w-[148px]">
      <div className="skeleton h-3 w-16 rounded" />
      <div className="skeleton h-6 w-full rounded" />
      <div className="skeleton h-3 w-10 rounded" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Market strip
// ---------------------------------------------------------------------------

function MarketStrip() {
  const { data, isLoading, error } = api.data.marketSnapshot.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const [errorDismissed, setErrorDismissed] = useState(false);

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === 'right' ? 320 : -320, behavior: 'smooth' });
  };

  if (error && !errorDismissed) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-hover)] px-4 py-3 text-[13px] text-muted">
        <span>Market snapshot unavailable — data service may be offline.</span>
        <button
          onClick={() => setErrorDismissed(true)}
          className="ml-auto text-[11px] text-muted hover:text-primary transition-colors"
          aria-label="Dismiss error"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-2">
      <button
        onClick={() => scroll('left')}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[var(--border)] text-muted hover:text-primary hover:bg-[var(--bg-hover)] transition-colors"
        aria-label="Scroll left"
      >
        <ChevronLeftIcon />
      </button>

      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto no-scrollbar flex-1"
      >
        {isLoading
          ? Array.from({ length: 8 }).map((_, i) => <SnapshotSkeleton key={i} />)
          : (data ?? []).map((item) => (
              <SnapshotCard key={item.ticker} {...item} />
            ))}
      </div>

      <button
        onClick={() => scroll('right')}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[var(--border)] text-muted hover:text-primary hover:bg-[var(--bg-hover)] transition-colors"
        aria-label="Scroll right"
      >
        <ChevronRightIcon />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <motion.section variants={slideUp} aria-labelledby={`section-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <h2
        id={`section-${label.toLowerCase().replace(/\s+/g, '-')}`}
        className="mono text-[11px] uppercase tracking-[0.12em] text-muted mb-4"
      >
        {label}
      </h2>
      {children}
    </motion.section>
  );
}

// ---------------------------------------------------------------------------
// Stat chip
// ---------------------------------------------------------------------------

function Stat({ label, value, dimValue }: { label: string; value: string; dimValue?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="mono text-[10px] uppercase tracking-[0.1em] text-muted">{label}</span>
      <span className="mono text-[20px] tabular-nums font-medium text-primary leading-none">
        {value}
        {dimValue && <span className="text-[13px] text-muted ml-1">{dimValue}</span>}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Saved portfolios
// ---------------------------------------------------------------------------

const ALGO_SHORT: Record<string, string> = {
  markowitz: 'MVO',
  hrp: 'HRP',
  risk_parity: 'ERC',
  cvar: 'CVaR',
  robust: 'Robust',
  black_litterman: 'B-L',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function SavedPortfoliosList() {
  const { status } = useSession();
  const utils = api.useUtils();

  const { data: portfolios, isLoading } = api.user.listPortfolios.useQuery(undefined, {
    enabled: status === 'authenticated',
    staleTime: 30_000,
  });

  const deleteMutation = api.user.deletePortfolio.useMutation({
    onSuccess: () => utils.user.listPortfolios.invalidate(),
  });

  const store = usePortfolioStore();

  const loadPortfolio = (p: SavedPortfolio) => {
    store.setTickers(p.tickers);
    store.setWeights(new Float64Array(p.weights));
  };

  if (status === 'loading' || isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-14 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border)] py-12 gap-2">
        <p className="text-[13px] text-muted">Sign in to save and load portfolios</p>
        <Link href="/login" className="text-[12px] text-accent hover:underline">Sign in</Link>
      </div>
    );
  }

  if (!portfolios || portfolios.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border)] py-12 gap-2">
        <p className="text-[13px] text-muted">No saved portfolios yet</p>
        <p className="text-[12px] text-muted opacity-60">Save a portfolio from the Optimize page.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {portfolios.map((p) => (
        <div
          key={p.id}
          className="flex items-center gap-4 rounded-lg border border-[var(--border)] px-4 py-3 hover:border-[var(--border-strong)] transition-colors"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[13px] font-medium text-primary truncate">{p.name}</span>
              <span className="mono text-[10px] text-muted bg-[var(--bg-hover)] border border-[var(--border)] rounded px-1.5 py-0.5 shrink-0">
                {ALGO_SHORT[p.algorithm] ?? p.algorithm}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted">
              <span>{p.tickers.slice(0, 4).join(', ')}{p.tickers.length > 4 ? ` +${p.tickers.length - 4}` : ''}</span>
              <span>·</span>
              <span className="tabular-nums">Sharpe {fmtNum(p.metrics.sharpe)}</span>
              <span>·</span>
              <span>{fmtDate(p.updatedAt)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/optimize"
              onClick={() => loadPortfolio(p)}
              className="flex h-7 items-center rounded border border-[var(--border)] bg-[var(--bg-hover)] px-3 text-[11px] font-medium text-primary hover:border-[var(--border-strong)] transition-colors"
            >
              Load
            </Link>
            <button
              onClick={() => deleteMutation.mutate({ id: p.id })}
              disabled={deleteMutation.isPending}
              className="flex h-7 w-7 items-center justify-center rounded border border-[var(--border)] text-muted hover:text-loss hover:border-[rgba(248,81,73,0.4)] transition-colors disabled:opacity-40"
              aria-label="Delete portfolio"
            >
              <TrashIcon />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const { tickers, activeAlgorithm, dateRange, frontier, currentWeights } = usePortfolioStore();
  const hasBacktest = useBacktestStore((s) => s.result !== null);

  const hasPortfolio = tickers.length >= 2 && currentWeights !== null;

  // Pull best-Sharpe stats from frontier if available
  const frontierSharpe = frontier?.bestIdx != null
    ? frontier.sharpes[frontier.bestIdx]
    : null;

  return (
    <div className="px-8 py-8 max-w-[1200px] mx-auto">
      <motion.div
        variants={stagger(0.06)}
        initial="initial"
        animate="animate"
        className="flex flex-col gap-10"
      >
        {/* ── Section 1: Greeting + quick stats ───────────────────── */}
        <motion.div variants={slideUp} className="flex flex-col gap-6">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-primary leading-tight">
              {getGreeting()}
            </h1>
            <p className="text-[13px] text-muted mt-1">
              {hasPortfolio
                ? `${tickers.length}-asset portfolio · ${ALGO_LABELS[activeAlgorithm] ?? activeAlgorithm}`
                : 'No portfolio loaded yet — head to Optimize to get started.'}
            </p>
          </div>

          {hasPortfolio && (
            <div className="flex flex-wrap gap-8">
              <Stat label="Assets" value={String(tickers.length)} />
              <Stat label="Algorithm" value={ALGO_LABELS[activeAlgorithm] ?? activeAlgorithm} />
              <Stat label="Date range" value={`${dateRange.start}`} dimValue={`→ ${dateRange.end}`} />
              {frontierSharpe != null && (
                <Stat label="Frontier Sharpe" value={fmtNum(frontierSharpe)} />
              )}
              {hasBacktest && (
                <Stat label="Backtest" value="Ready" dimValue="→ /backtest" />
              )}
            </div>
          )}
        </motion.div>

        {/* ── Section 2: Recent workspace ─────────────────────────── */}
        {hasPortfolio && (
          <Section label="Recent workspace">
            <div className="rounded-lg border border-[var(--border)] p-5">
              <div className="flex flex-wrap gap-2 mb-4">
                {tickers.map((t) => (
                  <span
                    key={t}
                    className="mono inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium text-primary bg-[var(--bg-hover)] border border-[var(--border)]"
                  >
                    {t}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap gap-6 text-[12px] text-muted">
                <span>Algorithm: <span className="text-primary">{ALGO_LABELS[activeAlgorithm] ?? activeAlgorithm}</span></span>
                <span>From <span className="text-primary">{dateRange.start}</span> to <span className="text-primary">{dateRange.end}</span></span>
                {currentWeights && (
                  <Link href="/optimize" className="text-accent hover:underline ml-auto">
                    Edit in Optimize →
                  </Link>
                )}
              </div>
            </div>
          </Section>
        )}

        {/* ── Section 3: Quick actions ─────────────────────────────── */}
        <Section label="Quick actions">
          <div className="grid grid-cols-3 gap-4">
            <ActionCard
              href="/optimize"
              icon={<OptimizeIcon />}
              label="Build Portfolio"
              description="Select assets, run the efficient frontier, pick weights."
            />
            <ActionCard
              href="/backtest"
              icon={<BacktestIcon />}
              label="Backtest"
              description="Walk-forward simulation with transaction costs and slippage."
            />
            <ActionCard
              href="/risk"
              icon={<RiskIcon />}
              label="Risk Analysis"
              description="VaR, CVaR, stress tests, correlation globe, rolling Sharpe."
            />
          </div>
        </Section>

        {/* ── Section 4: Market snapshot ───────────────────────────── */}
        <Section label="Market snapshot">
          <MarketStrip />
        </Section>

        {/* ── Section 5: Saved portfolios ──────────────────────────── */}
        <Section label="Saved portfolios">
          <SavedPortfoliosList />
        </Section>
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function OptimizeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  );
}

function BacktestIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 21V9" />
    </svg>
  );
}

function RiskIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}
