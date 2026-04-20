'use client';

import React from 'react';
import Link from 'next/link';
import { TrendingUp, LineChart, ShieldAlert, ArrowRight, type LucideIcon } from 'lucide-react';
import { MetricCard } from '@portopt/ui';
import { api } from '@/lib/trpc/client';
import { usePortfolioStore } from '@/lib/stores/portfolio';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const ALGO_LABELS: Record<string, string> = {
  markowitz:       'Markowitz',
  hrp:             'HRP',
  risk_parity:     'Risk Parity',
  cvar:            'CVaR',
  robust:          'Robust MVO',
  black_litterman: 'Black-Litterman',
};

// ---------------------------------------------------------------------------
// Sparkline — 1px stroke, fills cell width
// ---------------------------------------------------------------------------

function Sparkline({ values, positive }: { values: number[]; positive: boolean }) {
  if (values.length < 2) return <div style={{ height: 40 }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 100;
  const H = 40;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - ((v - min) / range) * (H - 4) - 2;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: 40, display: 'block' }}
      aria-hidden="true"
    >
      <polyline
        points={pts}
        fill="none"
        stroke={positive ? 'var(--positive)' : 'var(--negative)'}
        strokeWidth={1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Market snapshot grid
// ---------------------------------------------------------------------------

interface SnapshotItem {
  ticker: string;
  price: number;
  change_pct: number;
  sparkline: number[];
}

function SnapshotCell({ item, last }: { item: SnapshotItem; last: boolean }) {
  const pos = item.change_pct >= 0;
  return (
    <div
      style={{
        flex: 1,
        padding: '12px 16px',
        borderRight: last ? 'none' : '1px solid var(--border-subtle)',
        minWidth: 0,
      }}
    >
      {/* Top row: ticker + change */}
      <div className="flex items-center justify-between mb-1">
        <span
          className="text-[13px] text-primary"
          style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
        >
          {item.ticker}
        </span>
        <span
          className="text-[12px]"
          style={{
            fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'tabular-nums',
            color: pos ? 'var(--positive)' : 'var(--negative)',
          }}
        >
          {pos ? '+' : ''}{item.change_pct.toFixed(2)}%
        </span>
      </div>

      {/* Sparkline */}
      <Sparkline values={item.sparkline} positive={pos} />

      {/* Price */}
      <div className="mt-1">
        <span
          className="text-[13px] text-primary"
          style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
        >
          {item.price.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function SnapshotCellSkeleton({ last }: { last: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        padding: '12px 16px',
        borderRight: last ? 'none' : '1px solid var(--border-subtle)',
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="skeleton h-3 w-10 rounded" />
        <div className="skeleton h-3 w-12 rounded" />
      </div>
      <div className="skeleton rounded" style={{ height: 40, width: '100%', marginBottom: 6 }} />
      <div className="skeleton h-3 w-14 rounded" />
    </div>
  );
}

function MarketSnapshot() {
  const { data, isLoading, error } = api.data.marketSnapshot.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  if (error) {
    return (
      <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
        Market data unavailable
      </p>
    );
  }

  const items = data ?? [];
  // Show first 8 items, 4-up per row
  const visible = items.slice(0, 8);

  return (
    <div>
      {/* Row 1 */}
      <div
        style={{
          display: 'flex',
          borderBottom: visible.length > 4 ? '1px solid var(--border-subtle)' : 'none',
        }}
      >
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <SnapshotCellSkeleton key={i} last={i === 3} />
            ))
          : visible.slice(0, 4).map((item, i) => (
              <SnapshotCell key={item.ticker} item={item} last={i === 3} />
            ))}
      </div>
      {/* Row 2 */}
      {(isLoading || visible.length > 4) && (
        <div style={{ display: 'flex' }}>
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <SnapshotCellSkeleton key={i} last={i === 3} />
              ))
            : visible.slice(4, 8).map((item, i, arr) => (
                <SnapshotCell key={item.ticker} item={item} last={i === arr.length - 1} />
              ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick-action card
// ---------------------------------------------------------------------------

interface ActionCardProps {
  href: string;
  Icon: LucideIcon;
  title: string;
  description: string;
}

function ActionCard({ href, Icon, title, description }: ActionCardProps) {
  return (
    <Link
      href={href}
      className={[
        'group flex flex-col relative no-underline',
        'rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface)]',
        'hover:border-[var(--border)]',
        'transition-[border-color] duration-[var(--duration-micro)] ease-[var(--ease)]',
      ].join(' ')}
      style={{ height: 140, padding: 20 }}
    >
      <Icon
        size={16}
        strokeWidth={1.5}
        style={{ color: 'var(--text-tertiary)', marginBottom: 12, flexShrink: 0 }}
      />
      <p
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: 'var(--text-primary)',
          lineHeight: '24px',
          marginBottom: 4,
        }}
      >
        {title}
      </p>
      <p
        style={{
          fontSize: 13,
          color: 'var(--text-secondary)',
          lineHeight: '20px',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {description}
      </p>

      {/* Hover arrow — bottom-right */}
      <ArrowRight
        size={12}
        strokeWidth={1.5}
        style={{
          position: 'absolute',
          bottom: 14,
          right: 14,
          color: 'var(--text-tertiary)',
        }}
        className="opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--duration-micro)]"
      />
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Section header (text-h3)
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-h3" style={{ color: 'var(--text-tertiary)', marginBottom: 16 }}>
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const { tickers, activeAlgorithm, dateRange, frontier, currentWeights } = usePortfolioStore();

  const hasPortfolio = tickers.length >= 2 && currentWeights !== null;

  const frontierSharpe =
    frontier?.bestIdx != null ? frontier.sharpes[frontier.bestIdx] : null;

  const algoLabel = ALGO_LABELS[activeAlgorithm] ?? activeAlgorithm;

  return (
    <div
      className="slide-enter-content"
      style={{ display: 'flex', flexDirection: 'column', gap: 40, paddingBottom: 48 }}
    >

      {/* ── Header ── stagger 1 */}
      <div>
        <p className="text-body" style={{ color: 'var(--text-secondary)', marginBottom: 6 }}>
          {getGreeting()}
        </p>
        {hasPortfolio ? (
          <h1 className="text-h1" style={{ color: 'var(--text-primary)' }}>
            {tickers.length}-asset portfolio · {algoLabel}
          </h1>
        ) : (
          <h1 className="text-h1" style={{ color: 'var(--text-tertiary)' }}>
            No portfolio loaded
          </h1>
        )}
      </div>

      {/* ── Metric strip (portfolio loaded only) ── stagger 2 */}
      {hasPortfolio && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 32 }}>
          <MetricCard label="Assets" value={String(tickers.length)} />
          <MetricCard label="Algorithm" value={algoLabel} />
          <MetricCard
            label="Date range"
            value={`${dateRange.start.slice(0, 7)}`}
            sub={`→ ${dateRange.end.slice(0, 7)}`}
          />
          <MetricCard
            label="Frontier Sharpe"
            value={frontierSharpe != null ? frontierSharpe.toFixed(2) : '—'}
            color={frontierSharpe == null ? undefined : frontierSharpe >= 0 ? 'positive' : 'negative'}
          />
        </div>
      )}

      {/* ── Quick actions ── stagger 3 (or 2 when no portfolio) */}
      <section>
        <SectionLabel>Quick Actions</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <ActionCard href="/optimize" Icon={TrendingUp} title="Build Portfolio" description="Select assets, run the efficient frontier, pick weights." />
          <ActionCard href="/backtest" Icon={LineChart}  title="Backtest"        description="Walk-forward simulation with transaction costs and slippage." />
          <ActionCard href="/risk"     Icon={ShieldAlert} title="Risk Analysis"  description="VaR, CVaR, stress tests, correlation matrix, rolling Sharpe." />
        </div>
      </section>

      {/* ── Market snapshot ── stagger 4 (or 3 when no portfolio) */}
      <section>
        <SectionLabel>Market Snapshot</SectionLabel>
        <MarketSnapshot />
      </section>

    </div>
  );
}
