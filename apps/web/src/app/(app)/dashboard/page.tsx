'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { TrendingUp, Shield, Sparkles, type LucideIcon } from 'lucide-react';
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

const ALGO_SUBLABELS: Record<string, string> = {
  markowitz:       'Mean-Variance',
  hrp:             'Hierarchical RP',
  risk_parity:     'Risk Parity',
  cvar:            'Conditional VaR',
  robust:          'Robust MVO',
  black_litterman: 'Black-Litterman',
};

// ---------------------------------------------------------------------------
// Section 2 — Hero metric
// ---------------------------------------------------------------------------

interface HeroMetricProps {
  label: string;
  value: string;
  sub: string;
  mono?: boolean;
  serif?: boolean;
  large?: boolean;
  valueColor?: string;
}

function HeroMetric({ label, value, sub, mono = false, serif = false, large = false, valueColor }: HeroMetricProps) {
  return (
    <div style={{ flex: 1, padding: '24px 32px', minWidth: 0 }}>
      <p
        style={{
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--text-tertiary)',
          marginBottom: 8,
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: large ? 28 : 20,
          fontFamily: mono ? 'var(--font-mono)' : serif ? 'var(--font-serif)' : 'var(--font-sans)',
          fontWeight: serif ? 400 : 500,
          color: valueColor ?? 'var(--text-primary)',
          fontVariantNumeric: mono ? 'tabular-nums' : undefined,
          lineHeight: 1.2,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </p>
      <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
        {sub}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 3 — Activity feed
// ---------------------------------------------------------------------------

type ActivityType = 'optimize' | 'backtest' | 'risk' | 'saved';

interface ActivityEntry {
  type: ActivityType;
  desc: string;
  stats: string;
  time: string;
}

const DOT_COLORS: Record<ActivityType, string> = {
  optimize: '#3B82F6',
  backtest: '#8B5CF6',
  risk:     '#F59E0B',
  saved:    '#10B981',
};

const MOCK_ACTIVITY: ActivityEntry[] = [
  { type: 'optimize', desc: 'Optimized portfolio via Markowitz MVO', stats: 'Sharpe 0.99 · Vol 13.6% · Return 17.1%', time: '3h ago'    },
  { type: 'backtest', desc: 'Ran walk-forward backtest',              stats: 'CAGR -99.98% · Max DD -100%',             time: '5h ago'    },
  { type: 'risk',     desc: 'Detected 2-state HMM regimes',           stats: 'Bull 67% · Bear 33%',                     time: 'Yesterday' },
  { type: 'optimize', desc: 'Compared HRP vs Markowitz',              stats: 'HRP Sharpe 0.82 · MVO Sharpe 0.99',      time: '2d ago'    },
  { type: 'saved',    desc: 'Added TLT, GLD to universe',             stats: '6 assets now',                            time: '2d ago'    },
];

function ActivityRow({ entry, first }: { entry: ActivityEntry; first: boolean }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '12px 16px',
        borderTop: first ? 'none' : '1px solid var(--border-subtle)',
        background: hovered ? '#0F0F12' : 'transparent',
        marginLeft: -16,
        marginRight: -16,
        transition: `background var(--duration-micro) var(--ease)`,
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: DOT_COLORS[entry.type],
          flexShrink: 0,
          marginTop: 5,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: '20px', marginBottom: 3 }}>
          {entry.desc}
        </p>
        <p
          style={{
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-tertiary)',
            fontVariantNumeric: 'tabular-nums',
            lineHeight: '16px',
          }}
        >
          {entry.stats}
        </p>
      </div>
      <p
        style={{
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
          color: hovered ? 'var(--text-secondary)' : 'var(--text-tertiary)',
          fontVariantNumeric: 'tabular-nums',
          flexShrink: 0,
          marginTop: 2,
          transition: `color var(--duration-micro) var(--ease)`,
        }}
      >
        {entry.time}
      </p>
    </div>
  );
}

function ActivityFeed({ hasPortfolio }: { hasPortfolio: boolean }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <p
        style={{
          fontSize: 13,
          fontFamily: 'var(--font-mono)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--text-tertiary)',
          marginBottom: 16,
        }}
      >
        Recent activity
      </p>

      {hasPortfolio ? (
        <>
          {MOCK_ACTIVITY.map((entry, i) => (
            <ActivityRow key={i} entry={entry} first={i === 0} />
          ))}
          <div style={{ marginTop: 16 }}>
            <button
              type="button"
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                fontSize: 13,
                color: 'var(--text-tertiary)',
                cursor: 'pointer',
              }}
              className="hover:text-[var(--text-secondary)] transition-colors duration-[var(--duration-micro)]"
            >
              View all activity →
            </button>
          </div>
        </>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--text-tertiary)', paddingTop: 16 }}>
          No activity yet. Load a portfolio to get started.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 3 — New workspace card
// ---------------------------------------------------------------------------

const PRESETS = ['60/40 classic', 'All Weather', 'Tech mega-caps'] as const;

function NewWorkspaceCard() {
  return (
    <div
      style={{
        background: '#0F0F12',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <p style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-primary)', lineHeight: '24px' }}>
        New workspace
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 12, lineHeight: '20px' }}>
        Start with a preset or build from scratch.
      </p>
      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {PRESETS.map((preset) => (
          <Link key={preset} href="/optimize" style={{ textDecoration: 'none' }}>
            <button
              type="button"
              style={{
                width: '100%',
                height: 36,
                paddingLeft: 12,
                fontSize: 13,
                textAlign: 'left',
                background: 'var(--surface-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
              className="hover:bg-[#1F1F23] hover:text-[var(--text-primary)] transition-colors duration-[var(--duration-micro)]"
            >
              {preset}
            </button>
          </Link>
        ))}
      </div>
      <div style={{ marginTop: 16 }}>
        <Link
          href="/optimize"
          style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}
          className="hover:underline"
        >
          Start blank →
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 4 — Portfolio snapshot
// ---------------------------------------------------------------------------

type Period = '1D' | '1W' | '1M' | '3M' | '1Y';
const PERIODS: Period[] = ['1D', '1W', '1M', '3M', '1Y'];

// Deterministic PRNG seeded by ticker + period string
function hashSeed(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function seededRng(seed: number): () => number {
  let s = (seed | 1) >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const PERIOD_CONFIG: Record<Period, { points: number; amplitude: number; trend: number }> = {
  '1D': { points: 24,  amplitude: 0.01, trend: 0      },
  '1W': { points: 7,   amplitude: 0.03, trend: 0      },
  '1M': { points: 30,  amplitude: 0.08, trend: 0.001  },
  '3M': { points: 90,  amplitude: 0.15, trend: 0.002  },
  '1Y': { points: 252, amplitude: 0.30, trend: 0.003  },
};

function generateMockSparkline(ticker: string, period: Period): number[] {
  const { points, amplitude, trend } = PERIOD_CONFIG[period];
  const rng = seededRng(hashSeed(ticker + period));
  const step = (amplitude * 2) / Math.sqrt(points);
  const values: number[] = [100];
  for (let i = 1; i < points; i++) {
    const noise = (rng() - 0.5) * step;
    values.push(values[i - 1] * (1 + trend + noise));
  }
  return values;
}

// 60/40 benchmark: mock 30-day index (base 100), slight upward drift ending with a small down day
const SIXTY_FORTY_SPARKLINE: number[] = [
   99.10,  99.28,  99.45,  99.22,  99.41,  99.83, 100.12,  99.98, 100.31, 100.52,
  100.44, 100.71, 100.93, 101.12, 101.04, 101.33, 101.52, 101.41, 101.74, 101.92,
  102.18, 102.03, 102.31, 102.51, 102.73, 102.61, 102.84, 103.02, 102.83, 102.34,
];
const SIXTY_FORTY_CARD: AssetCardData = {
  ticker: '60/40',
  price:     102.34,
  changePct: -0.47,
  sparkline: SIXTY_FORTY_SPARKLINE,
  isBenchmark: true,
};

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
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface AssetCardData {
  ticker: string;
  price?: number;
  changePct?: number;
  sparkline?: number[];
  isBenchmark?: boolean;
}

function PeriodButton({ p, selected, onClick }: { p: Period; selected: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      key={p}
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        fontSize: 12,
        fontFamily: 'var(--font-mono)',
        cursor: 'pointer',
        fontWeight: selected ? 500 : 400,
        fontVariantNumeric: 'tabular-nums',
        color: selected ? '#EDEDEE' : hovered ? '#A1A1A8' : '#6B6B73',
        transition: `color var(--duration-micro) var(--ease)`,
      }}
    >
      {p}
    </button>
  );
}

function AssetCard({
  ticker,
  price,
  changePct: apiChangePct,
  sparkline: apiSparkline = [],
  isBenchmark = false,
  isLoading = false,
  period = '1D',
}: AssetCardData & { isLoading?: boolean; period?: Period }) {

  const { displaySparkline, displayChangePct } = React.useMemo(() => {
    if (period === '1D') {
      return { displaySparkline: apiSparkline, displayChangePct: apiChangePct };
    }
    const mock = generateMockSparkline(ticker, period);
    const pct = mock.length > 1
      ? ((mock[mock.length - 1] - mock[0]) / mock[0]) * 100
      : undefined;
    return { displaySparkline: mock, displayChangePct: pct };
  }, [ticker, period, apiSparkline, apiChangePct]);

  const pos = (displayChangePct ?? 0) >= 0;

  if (isLoading) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <div className="skeleton h-3 w-10 rounded" />
          <div className="skeleton h-3 w-12 rounded" />
        </div>
        <div className="skeleton rounded" style={{ height: 40, marginBottom: 6 }} />
        <div className="skeleton h-3 w-14 rounded" />
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Top row: ticker + change % */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <span
            style={{
              fontSize: 13,
              fontFamily: 'var(--font-mono)',
              fontWeight: 500,
              color: 'var(--text-primary)',
              fontVariantNumeric: 'tabular-nums',
              display: 'block',
            }}
          >
            {ticker}
          </span>
          {isBenchmark && (
            <span
              style={{
                fontSize: 10,
                fontFamily: 'var(--font-mono)',
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                color: 'var(--text-tertiary)',
                display: 'block',
                marginTop: 2,
              }}
            >
              Benchmark
            </span>
          )}
        </div>
        <span
          style={{
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'tabular-nums',
            color: displayChangePct === undefined
              ? 'var(--text-tertiary)'
              : pos
                ? 'var(--positive)'
                : 'var(--negative)',
          }}
        >
          {displayChangePct !== undefined
            ? `${pos ? '+' : ''}${displayChangePct.toFixed(2)}%`
            : '—'}
        </span>
      </div>

      {/* Sparkline */}
      {displaySparkline.length > 1 ? (
        <Sparkline values={displaySparkline} positive={pos} />
      ) : (
        <div
          style={{
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            —
          </span>
        </div>
      )}

      {/* Price */}
      <p
        style={{
          fontSize: 14,
          fontFamily: 'var(--font-mono)',
          fontVariantNumeric: 'tabular-nums',
          color: price !== undefined ? 'var(--text-primary)' : 'var(--text-tertiary)',
          marginTop: 4,
        }}
      >
        {price !== undefined ? price.toFixed(2) : '—'}
      </p>
    </div>
  );
}

function PortfolioSnapshot({ portfolioTickers }: { portfolioTickers: string[] }) {
  const [period, setPeriod] = useState<Period>('1D');

  const { data, isLoading, error } = api.data.portfolioSnapshot.useQuery(
    { tickers: portfolioTickers },
    { staleTime: 5 * 60 * 1000, retry: 1 }
  );

  const items = data ?? [];

  // Build portfolio item list (preserves order)
  const portfolioItems = portfolioTickers.map(
    (t) => items.find((i) => i.ticker === t) ?? null
  );

  // Equal-weight benchmark: average of available portfolio items
  const validItems = portfolioItems.filter((x): x is (typeof items)[number] => x !== null);
  const ewChangePct =
    validItems.length > 0
      ? validItems.reduce((sum, i) => sum + i.change_pct, 0) / validItems.length
      : null;
  const ewSparkline: number[] = (() => {
    if (validItems.length === 0) return [];
    const len = Math.min(...validItems.map((i) => i.sparkline.length));
    return Array.from({ length: len }, (_, idx) =>
      validItems.reduce((sum, i) => sum + i.sparkline[idx], 0) / validItems.length
    );
  })();
  // Normalize EW sparkline to a 100-base index for the price display
  const ewPrice =
    ewSparkline.length > 1
      ? parseFloat(((ewSparkline[ewSparkline.length - 1] / ewSparkline[0]) * 100).toFixed(2))
      : undefined;

  // Final 8 display cells: portfolio assets + EW benchmark + 60/40 benchmark
  const displayCells: Array<{ data: AssetCardData; loading: boolean }> = [
    ...portfolioItems.map((item, i) => ({
      data: item
        ? { ticker: item.ticker, price: item.price, changePct: item.change_pct, sparkline: item.sparkline }
        : { ticker: portfolioTickers[i] },
      loading: isLoading,
    })),
    {
      data: {
        ticker: 'EW',
        price: ewPrice,
        changePct: ewChangePct ?? undefined,
        sparkline: ewSparkline,
        isBenchmark: true,
      },
      loading: isLoading && validItems.length === 0,
    },
    {
      data: SIXTY_FORTY_CARD,
      loading: false,
    },
  ];

  return (
    <section>
      {/* Section header + period toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <p
          style={{
            fontSize: 13,
            fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--text-tertiary)',
          }}
        >
          {({
            '1D': 'Your assets · today',
            '1W': 'Your assets · this week',
            '1M': 'Your assets · this month',
            '3M': 'Your assets · last 3 months',
            '1Y': 'Your assets · last year',
          } as Record<Period, string>)[period]}
        </p>
        <div style={{ display: 'flex', gap: 12 }}>
          {PERIODS.map((p) => (
            <PeriodButton
              key={p}
              p={p}
              selected={period === p}
              onClick={() => setPeriod(p)}
            />
          ))}
        </div>
      </div>

      {/* 4×2 grid — borders do the grouping work, no card backgrounds */}
      {error ? (
        <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Market data unavailable</p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            borderTop: '1px solid var(--border-subtle)',
            borderLeft: '1px solid var(--border-subtle)',
          }}
        >
          {displayCells.map(({ data: cell, loading }, i) => (
            <div
              key={cell.ticker || i}
              style={{
                borderRight: '1px solid var(--border-subtle)',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <AssetCard {...cell} isLoading={loading} period={period} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section 5 — Next steps
// ---------------------------------------------------------------------------

interface NextStepProps {
  href: string;
  Icon: LucideIcon;
  title: string;
  description: string;
}

function NextStepTile({ href, Icon, title, description }: NextStepProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <Link
      href={href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: 24,
        background: '#0F0F12',
        border: `1px solid ${hovered ? '#2A2A2F' : 'var(--border-subtle)'}`,
        borderRadius: 'var(--radius-md)',
        textDecoration: 'none',
        position: 'relative',
        transition: `border-color var(--duration-micro) var(--ease)`,
        minHeight: 120,
      }}
    >
      <Icon
        size={16}
        strokeWidth={1.5}
        style={{ color: hovered ? 'var(--text-primary)' : 'var(--text-secondary)', flexShrink: 0, transition: `color var(--duration-micro) var(--ease)` }}
      />
      <p
        style={{
          fontSize: 15,
          fontWeight: 500,
          color: 'var(--text-primary)',
          marginTop: 12,
          lineHeight: '22px',
        }}
      >
        {title}
      </p>
      <p
        style={{
          fontSize: 13,
          color: 'var(--text-secondary)',
          marginTop: 4,
          lineHeight: '20px',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {description}
      </p>
      <span
        style={{
          position: 'absolute',
          bottom: 16,
          right: 16,
          fontSize: 14,
          color: hovered ? 'var(--text-primary)' : 'var(--text-tertiary)',
          transition: `color var(--duration-micro) var(--ease)`,
        }}
      >
        →
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Empty state — replaces Section 2 + Section 4 when no portfolio loaded
// ---------------------------------------------------------------------------

const EMPTY_PRESETS = ['60/40 classic', 'All Weather', 'Tech mega-caps', 'Custom tickers'] as const;

function EmptyPortfolioState() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        padding: '64px 0',
        maxWidth: 560,
        margin: '0 auto',
      }}
    >
      <p
        style={{
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--text-tertiary)',
          marginBottom: 16,
        }}
      >
        No portfolio loaded
      </p>
      <h1
        style={{
          fontSize: 24,
          fontFamily: 'var(--font-serif)',
          fontWeight: 400,
          color: 'var(--text-primary)',
          lineHeight: '32px',
          marginBottom: 12,
        }}
      >
        Start with a universe of assets.
      </h1>
      <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: '24px', marginBottom: 32 }}>
        Pick a preset to see the full flow — frontier, backtest, risk, research — or enter your own tickers.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        {EMPTY_PRESETS.map((preset) => (
          <Link key={preset} href="/optimize" style={{ textDecoration: 'none' }}>
            <button
              type="button"
              style={{
                height: 44,
                padding: '0 16px',
                fontSize: 14,
                background: 'var(--surface-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
              className="hover:bg-[#1F1F23] hover:text-[var(--text-primary)] transition-colors duration-[var(--duration-micro)]"
            >
              {preset}
            </button>
          </Link>
        ))}
      </div>
    </div>
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

  const algoLabel    = ALGO_LABELS[activeAlgorithm]    ?? activeAlgorithm;
  const algoSublabel = ALGO_SUBLABELS[activeAlgorithm] ?? '';

  const startYear = dateRange.start.slice(0, 4);
  const endYear   = dateRange.end.slice(0, 4);
  const years     = parseInt(endYear) - parseInt(startYear);
  const durationLabel = `${years} year${years !== 1 ? 's' : ''} daily`;

  const sharpeColor =
    frontierSharpe == null
      ? 'var(--text-secondary)'
      : frontierSharpe > 0.8
        ? 'var(--positive)'
        : frontierSharpe >= 0.5
          ? 'var(--text-secondary)'
          : 'var(--negative)';

  return (
    <div className="slide-enter-content" style={{ display: 'flex', flexDirection: 'column', gap: 40, paddingBottom: 64 }}>

      {hasPortfolio ? (
        <>
          {/* ── Section 2 — Portfolio identity ── */}
          <section>
            <p style={{ fontSize: 14, color: 'var(--text-tertiary)', marginBottom: 4 }}>
              {getGreeting()}
            </p>
            <div style={{ display: 'flex', alignItems: 'baseline' }}>
              <span
                style={{
                  fontSize: 32,
                  fontFamily: 'var(--font-serif)',
                  fontWeight: 400,
                  color: 'var(--text-primary)',
                  lineHeight: 1.2,
                }}
              >
                {tickers.length}-asset portfolio
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--border-strong)',
                  margin: '0 12px',
                  userSelect: 'none',
                }}
              >
                ·
              </span>
              <span
                style={{
                  fontSize: 32,
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 400,
                  color: 'var(--text-secondary)',
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: 1.2,
                }}
              >
                {algoLabel}
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                marginTop: 32,
                borderTop: '1px solid var(--border-subtle)',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <HeroMetric label="ASSETS" value={String(tickers.length)} sub={`${tickers.length} tickers`} mono large />
              <div style={{ width: 1, flexShrink: 0, background: '#1F1F23', alignSelf: 'stretch' }} />
              <HeroMetric label="ALGORITHM" value={algoLabel} sub={algoSublabel} serif />
              <div style={{ width: 1, flexShrink: 0, background: '#1F1F23', alignSelf: 'stretch' }} />
              <HeroMetric label="DATE RANGE" value={`${startYear} → ${endYear}`} sub={durationLabel} mono />
              <div style={{ width: 1, flexShrink: 0, background: '#1F1F23', alignSelf: 'stretch' }} />
              <HeroMetric
                label="FRONTIER SHARPE"
                value={frontierSharpe != null ? frontierSharpe.toFixed(2) : '—'}
                sub="max tangency"
                mono
                large
                valueColor={sharpeColor}
              />
            </div>

            <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
              <Link
                href="/optimize"
                style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}
                className="hover:underline"
              >
                Continue in Optimize →
              </Link>
            </div>
          </section>

          {/* ── Section 3 — Recent activity + New workspace ── */}
          <section style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24, alignItems: 'start' }}>
            <ActivityFeed hasPortfolio />
            <NewWorkspaceCard />
          </section>

          {/* ── Section 4 — Portfolio snapshot ── */}
          <PortfolioSnapshot portfolioTickers={tickers} />

          {/* ── Section 5 — Next steps ── */}
          <section>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              <NextStepTile
                href="/optimize"
                Icon={TrendingUp}
                title="Refine this portfolio"
                description="Switch algorithms, adjust constraints, or add assets in Optimize."
              />
              <NextStepTile
                href="/risk"
                Icon={Shield}
                title="Stress-test it"
                description="Run Monte Carlo, VaR, CVaR, and regime detection in Risk."
              />
              <NextStepTile
                href="/research"
                Icon={Sparkles}
                title="Ask Groq"
                description="Get a natural-language explanation of what's driving your portfolio's risk."
              />
            </div>
          </section>
        </>
      ) : (
        <>
          {/* ── Empty state (covers Section 2 + Section 4) ── */}
          <EmptyPortfolioState />

          {/* ── Section 3 — Recent activity + New workspace ── */}
          <section style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24, alignItems: 'start' }}>
            <ActivityFeed hasPortfolio={false} />
            <NewWorkspaceCard />
          </section>

          {/* ── Section 5 — Next steps ── */}
          <section>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              <NextStepTile
                href="/optimize"
                Icon={TrendingUp}
                title="Refine this portfolio"
                description="Switch algorithms, adjust constraints, or add assets in Optimize."
              />
              <NextStepTile
                href="/risk"
                Icon={Shield}
                title="Stress-test it"
                description="Run Monte Carlo, VaR, CVaR, and regime detection in Risk."
              />
              <NextStepTile
                href="/research"
                Icon={Sparkles}
                title="Ask Groq"
                description="Get a natural-language explanation of what's driving your portfolio's risk."
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
