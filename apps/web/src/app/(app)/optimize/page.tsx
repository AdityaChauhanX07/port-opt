'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { skipToken } from '@tanstack/react-query';
import { EfficientFrontier, WeightBar } from '@portopt/charts';
import type { FrontierPoint, AssetStat, AlgorithmMarker, HoverMetrics } from '@portopt/charts';
import { Button, Card, Input, MetricCard, Select, Slider, Switch } from '@portopt/ui';
import { api } from '../../../lib/trpc/client';
import { usePortfolioStore } from '../../../lib/stores/portfolio';
import { useEngine } from '../../../lib/wasm/use-engine';
import { slideUp, stagger } from '../../../lib/motion';
import { useKeyboard } from '../../../lib/hooks/use-keyboard';
import { loadDefaults } from '@/components/SettingsDialog';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TICKERS = ['AAPL', 'MSFT', 'TLT', 'GLD', 'IWM', 'SPY'];

function defaultDateRange() {
  const end   = new Date();
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 5);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

const PPY: Record<string, number> = { daily: 252, weekly: 52, monthly: 12 };

const ALGORITHM_TABS = [
  { value: 'markowitz',       label: 'MVO',    name: 'Markowitz MVO',   desc: 'Mean-variance frontier'    },
  { value: 'hrp',             label: 'HRP',    name: 'HRP',             desc: 'Hierarchical risk parity'  },
  { value: 'risk_parity',     label: 'ERC',    name: 'ERC',             desc: 'Equal risk contribution'   },
  { value: 'cvar',            label: 'CVaR',   name: 'CVaR',            desc: 'Conditional value at risk' },
  { value: 'robust',          label: 'Robust', name: 'Robust MVO',      desc: 'Uncertainty-aware MVO'     },
  { value: 'black_litterman', label: 'B-L',    name: 'Black-Litterman', desc: 'Equilibrium + views'       },
];

const OVERLAY_ALGORITHMS = ['hrp', 'risk_parity', 'cvar', 'robust'] as const;
type OverlayAlgorithm = typeof OVERLAY_ALGORITHMS[number];

const POINT_MODE_ALGORITHMS = new Set(['hrp', 'risk_parity', 'cvar', 'robust']);

const POINT_MODE_LABELS: Record<string, string> = {
  hrp:          'HRP optimal',
  risk_parity:  'ERC optimal',
  cvar:         'CVaR-95% optimal',
  robust:       'Robust optimal',
};

const PRESET_OPTIONS = [
  { value: 'custom',      label: 'Custom'       },
  { value: '60_40',       label: '60/40'        },
  { value: 'all_weather', label: 'All Weather'  },
  { value: 'tech',        label: 'Tech Mega-caps'},
];

const PRESETS: Record<string, string[]> = {
  '60_40':       ['SPY', 'IWM', 'TLT', 'IEF', 'LQD', 'SHY'],
  'all_weather': ['SPY', 'TLT', 'GLD', 'IEF', 'GSG'],
  'tech':        ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META'],
};

const FREQ_LABELS: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

// ── Black-Litterman view types ────────────────────────────────────────────
type BlDirection = 'returns' | 'outperforms';

interface BlViewRow {
  id: string;
  assetIdx: number;
  direction: BlDirection;
  targetAssetIdx: number;
  expectedReturn: number;
  confidence: number;
}

type Algorithm = 'markowitz' | 'hrp' | 'risk_parity' | 'cvar' | 'robust' | 'black_litterman';

// ---------------------------------------------------------------------------
// Math helpers (unchanged)
// ---------------------------------------------------------------------------

function computeCovariance(
  returns: Float64Array,
  nPeriods: number,
  nAssets: number,
): Float64Array {
  const means = new Array<number>(nAssets).fill(0);
  for (let a = 0; a < nAssets; a++) {
    for (let t = 0; t < nPeriods; t++) means[a] += returns[t * nAssets + a];
    means[a] /= nPeriods;
  }
  const cov = new Float64Array(nAssets * nAssets);
  for (let a = 0; a < nAssets; a++) {
    for (let b = a; b < nAssets; b++) {
      let s = 0;
      for (let t = 0; t < nPeriods; t++) {
        s += (returns[t * nAssets + a] - means[a]) * (returns[t * nAssets + b] - means[b]);
      }
      cov[a * nAssets + b] = cov[b * nAssets + a] = s / (nPeriods - 1);
    }
  }
  return cov;
}

function portfolioStats(
  returns: Float64Array,
  nPeriods: number,
  nAssets: number,
  weights: number[] | Float64Array,
  rf: number,
  ppy: number,
) {
  let sumR = 0, sumR2 = 0;
  for (let t = 0; t < nPeriods; t++) {
    let r = 0;
    for (let a = 0; a < nAssets; a++) r += weights[a] * returns[t * nAssets + a];
    sumR  += r;
    sumR2 += r * r;
  }
  const mean     = sumR / nPeriods;
  const variance = (sumR2 - nPeriods * mean * mean) / Math.max(nPeriods - 1, 1);
  const vol      = Math.sqrt(Math.max(variance, 0) * ppy);
  const ret      = mean * ppy;
  const sharpe   = vol > 0 ? (ret - rf) / vol : 0;
  return { ret, vol, sharpe };
}

function computeMaxDrawdown(
  returns: Float64Array,
  nPeriods: number,
  nAssets: number,
  weights: number[] | Float64Array,
): number {
  let peak = 1;
  let value = 1;
  let maxDD = 0;
  for (let t = 0; t < nPeriods; t++) {
    let r = 0;
    for (let a = 0; a < nAssets; a++) r += (weights[a] ?? 0) * (returns[t * nAssets + a] ?? 0);
    value *= (1 + r);
    if (value > peak) peak = value;
    const dd = (peak - value) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function computeAssetStats(
  returns: Float64Array,
  nPeriods: number,
  nAssets: number,
  tickers: string[],
  ppy: number,
): AssetStat[] {
  return tickers.map((ticker, a) => {
    let sum = 0, sum2 = 0;
    for (let t = 0; t < nPeriods; t++) {
      const v = returns[t * nAssets + a];
      sum  += v;
      sum2 += v * v;
    }
    const mean = sum / nPeriods;
    const variance = (sum2 - nPeriods * mean * mean) / Math.max(nPeriods - 1, 1);
    return {
      ticker,
      vol: Math.sqrt(Math.max(variance, 0) * ppy),
      ret: mean * ppy,
    };
  });
}

// ---------------------------------------------------------------------------
// Metric display (right panel, unchanged)
// ---------------------------------------------------------------------------

function MetricDisplay({
  label,
  value,
  format,
  colorClass = 'text-primary',
}: {
  label: string;
  value: number | null;
  format: (v: number) => string;
  colorClass?: string;
}) {
  const displayed = value !== null ? format(value) : '—';
  return (
    <div className="flex-1 min-w-0">
      <p className="mb-1 text-[11px] uppercase tracking-[0.06em] text-tertiary">{label}</p>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={displayed}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className={`mono text-[22px] font-semibold leading-none ${colorClass}`}
        >
          {displayed}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Horizontal metrics strip
// ---------------------------------------------------------------------------

interface MetricEntry {
  label: string;
  sublabel: string;
  value: string;
  color: string;
}

function MetricsStrip({ entries }: { entries: MetricEntry[] }) {
  return (
    <div
      style={{
        display: 'flex',
        paddingTop: 24,
        paddingBottom: 24,
        borderTop: '1px solid var(--border-subtle)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      {entries.map((entry, i) => (
        <div
          key={entry.label}
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            borderLeft: i > 0 ? '1px solid #1F1F23' : 'none',
            padding: '0 16px',
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--text-tertiary)',
              fontFamily: 'var(--font-sans)',
            }}
          >
            {entry.label}
          </span>
          <span
            style={{
              fontSize: 28,
              fontWeight: 600,
              fontFamily: 'var(--font-mono)',
              color: entry.color,
              lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {entry.value}
          </span>
          <span
            style={{
              fontSize: 12,
              color: '#6B6B73',
              fontFamily: 'var(--font-sans)',
            }}
          >
            {entry.sublabel}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left panel primitives
// ---------------------------------------------------------------------------

function PanelSection({
  title,
  children,
  defaultOpen = true,
  noBorder = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  noBorder?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: noBorder ? 'none' : '1px solid var(--border-subtle)' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 hover:bg-[var(--surface)] transition-colors duration-[var(--duration-micro)]"
      >
        <span className="text-h3" style={{ color: 'var(--text-tertiary)' }}>{title}</span>
        <ChevronDown
          size={12}
          strokeWidth={2}
          style={{
            color: 'var(--text-tertiary)',
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: `transform var(--duration-micro) var(--ease)`,
          }}
        />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function ChipInput({
  tickers,
  onAdd,
  onRemove,
}: {
  tickers: string[];
  onAdd: (t: string) => void;
  onRemove: (t: string) => void;
}) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function commit(raw: string) {
    const ticker = raw.trim().toUpperCase().replace(/[^A-Z0-9.]/g, '');
    if (ticker && !tickers.includes(ticker)) onAdd(ticker);
    setInput('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(input);
    } else if (e.key === 'Backspace' && !input && tickers.length > 0) {
      onRemove(tickers[tickers.length - 1]!);
    }
  }

  return (
    <div
      className="flex flex-wrap gap-1 items-center rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 min-h-[36px] focus-within:border-[var(--border-strong)] transition-colors duration-[var(--duration-micro)] cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {tickers.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 border border-[var(--border)] bg-[var(--surface-elevated)]"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-primary)' }}
        >
          {t}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove(t); }}
            className="text-tertiary hover:text-primary transition-colors leading-none"
            style={{ fontSize: 14, lineHeight: 1 }}
            aria-label={`Remove ${t}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (input.trim()) commit(input); }}
        placeholder={tickers.length === 0 ? 'AAPL, MSFT, …' : ''}
        className="flex-1 min-w-[60px] bg-transparent border-none outline-none text-[13px] text-primary placeholder:text-tertiary"
        style={{ fontFamily: 'var(--font-mono)' }}
      />
    </div>
  );
}

function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex h-7 rounded border border-[var(--border)] overflow-hidden">
      {options.map((opt, i) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={[
            'flex-1 text-[12px] font-medium transition-colors duration-[var(--duration-micro)]',
            i > 0 ? 'border-l border-[var(--border)]' : '',
            value === opt.value
              ? 'bg-[var(--surface-elevated)] text-primary'
              : 'text-secondary hover:text-primary',
          ].join(' ')}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function AlgoList({
  value,
  onChange,
}: {
  value: Algorithm;
  onChange: (v: Algorithm) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {ALGORITHM_TABS.map((algo) => {
        const active = value === algo.value;
        return (
          <button
            key={algo.value}
            type="button"
            onClick={() => onChange(algo.value as Algorithm)}
            className={[
              'flex flex-col justify-center gap-0.5 text-left outline-none select-none',
              'transition-colors duration-[var(--duration-micro)]',
              active ? '' : 'hover:bg-[#0F0F12]',
            ].join(' ')}
            style={{
              height: 56,
              padding: '0 16px',
              background: active ? '#17171A' : 'transparent',
              border: 'none',
              borderLeft: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 500, color: '#EDEDEE', lineHeight: 1.3 }}>
              {algo.name}
            </span>
            <span style={{ fontSize: 12, color: '#6B6B73', lineHeight: 1.3 }}>
              {algo.desc}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ConstraintRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-[13px] text-secondary shrink-0">{label}</span>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// B-L view item
// ---------------------------------------------------------------------------

const DIRECTION_OPTIONS = [
  { value: 'returns',     label: 'will return'  },
  { value: 'outperforms', label: 'outperforms'  },
];

function BlViewItem({
  view,
  tickers,
  nAssets,
  onUpdate,
  onDelete,
}: {
  view: BlViewRow;
  tickers: string[];
  nAssets: number;
  onUpdate: (patch: Partial<BlViewRow>) => void;
  onDelete: () => void;
}) {
  const assetOptions = tickers.length > 0
    ? tickers.map((t, i) => ({ value: String(i), label: t }))
    : Array.from({ length: nAssets }, (_, i) => ({ value: String(i), label: `Asset ${i}` }));

  return (
    <div className="flex flex-col gap-1.5 rounded border border-[var(--border)] bg-[var(--bg-inset)] p-2.5">
      <div className="flex items-center gap-1.5">
        <Select
          value={String(view.assetIdx)}
          onValueChange={(v) => onUpdate({ assetIdx: Number(v) })}
          options={assetOptions}
          className="flex-1 h-7 text-[11px]"
        />
        <Select
          value={view.direction}
          onValueChange={(v) => onUpdate({ direction: v as BlDirection })}
          options={DIRECTION_OPTIONS}
          className="flex-1 h-7 text-[11px]"
        />
        <button
          type="button"
          onClick={onDelete}
          className="shrink-0 text-tertiary hover:text-negative transition-colors text-[15px] leading-none px-1"
          aria-label="Remove view"
        >
          ×
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        {view.direction === 'outperforms' && (
          <Select
            value={String(view.targetAssetIdx)}
            onValueChange={(v) => onUpdate({ targetAssetIdx: Number(v) })}
            options={assetOptions.filter((o) => o.value !== String(view.assetIdx))}
            className="flex-1 h-7 text-[11px]"
          />
        )}
        <div className="flex items-center gap-1 flex-1">
          <Input
            type="number"
            variant="mono"
            step={0.5}
            value={view.expectedReturn}
            onChange={(e) => onUpdate({ expectedReturn: parseFloat(e.target.value) || 0 })}
            className="h-7 text-[11px]"
          />
          <span className="text-[11px] text-tertiary shrink-0">%</span>
        </div>
      </div>

      <Slider
        label={`Confidence: ${Math.round(view.confidence * 100)}%`}
        value={view.confidence}
        min={0.05}
        max={0.95}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => onUpdate({ confidence: v })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// B-L posterior vs implied returns chart — hero section
// ---------------------------------------------------------------------------

function BlReturnsChart({
  tickers,
  implied,
  posterior,
  views,
}: {
  tickers: string[];
  implied: Float64Array;
  posterior: Float64Array;
  views: BlViewRow[];
}) {
  const n = tickers.length;

  // Find the shared max-abs for the zero-baseline chart
  let maxAbs = 1e-12;
  for (let i = 0; i < n; i++) {
    maxAbs = Math.max(maxAbs, Math.abs(implied[i] ?? 0), Math.abs(posterior[i] ?? 0));
  }

  // For zero-baseline: positive goes right, negative goes left from center (50%)
  function barStyle(val: number, color: string): React.CSSProperties {
    const frac = Math.abs(val) / maxAbs; // 0–1
    const isNeg = val < 0;
    return {
      position: 'absolute' as const,
      top: 0,
      bottom: 0,
      left: isNeg ? `${(0.5 - frac * 0.5) * 100}%` : '50%',
      width: `${frac * 50}%`,
      background: color,
      borderRadius: 2,
      transition: 'left var(--duration-micro) var(--ease), width var(--duration-micro) var(--ease)',
    };
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Section title */}
      <p style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}>
        Expected returns — implied vs posterior
      </p>

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-tertiary)' }}>
          <span style={{ display: 'inline-block', width: 16, height: 8, borderRadius: 2, background: '#3A3A42' }} />
          Implied
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-tertiary)' }}>
          <span style={{ display: 'inline-block', width: 16, height: 8, borderRadius: 2, background: '#3B82F6' }} />
          Posterior
        </span>
      </div>

      {/* One row per asset — implied bar (full height, behind) + posterior bar (inset, in front) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {tickers.map((ticker, i) => {
          const imp  = implied[i]   ?? 0;
          const post = posterior[i] ?? 0;
          const impPct  = (imp  * 100).toFixed(1);
          const postPct = (post * 100).toFixed(1);

          return (
            <div
              key={ticker}
              style={{ display: 'grid', gridTemplateColumns: '56px 1fr 52px', alignItems: 'center', gap: 8 }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>
                {ticker}
              </span>

              {/* Single 28px track — implied sits full-height, posterior inset 5px on each side */}
              <div
                style={{
                  height: 28,
                  background: 'var(--surface)',
                  borderRadius: 3,
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                {/* Implied bar — full height, rendered first (behind) */}
                <div style={{ ...barStyle(imp, '#3A3A42'), top: 0, bottom: 0 }} />
                {/* Posterior bar — inset so both bars are visible when they differ */}
                <div style={{ ...barStyle(post, '#3B82F6'), top: 6, bottom: 6 }} />
                {/* Shared zero baseline */}
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, background: 'var(--border-subtle)' }} />
              </div>

              {/* Values: implied (muted) above, posterior (blue) below */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-end' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)' }}>{impPct}%</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#3B82F6' }}>{postPct}%</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Views section — always visible once B-L result is showing */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: '#6B6B73',
            fontFamily: 'var(--font-mono)',
          }}
        >
          Views
        </p>
        {views.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {views.map((v) => {
              const assetName = tickers[v.assetIdx] ?? `Asset ${v.assetIdx}`;
              const label = v.direction === 'returns'
                ? `${assetName} → ${v.expectedReturn.toFixed(0)}% return, ${Math.round(v.confidence * 100)}% confidence`
                : `${assetName} outperforms ${tickers[v.targetAssetIdx] ?? `Asset ${v.targetAssetIdx}`} by ${v.expectedReturn.toFixed(0)}%`;
              return (
                <span
                  key={v.id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '3px 10px',
                    borderRadius: 4,
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </span>
              );
            })}
          </div>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            No views — pure equilibrium
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function OptimizePage() {
  const defaultRange = useMemo(defaultDateRange, []);

  // ── Chip input state ─────────────────────────────────────────────────────
  const [localTickers, setLocalTickers] = useState<string[]>(DEFAULT_TICKERS);
  const [preset,       setPreset]       = useState('custom');

  // ── Form state ───────────────────────────────────────────────────────────
  const [startDate, setStartDate] = useState(defaultRange.start);
  const [endDate,   setEndDate]   = useState(defaultRange.end);
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  // ── Zustand store ────────────────────────────────────────────────────────
  const store   = usePortfolioStore();
  const returns = store.returns;
  const {
    tickers: storeTickers,
    nPeriods,
    nAssets,
    frontier,
    currentWeights,
    isOptimizing,
    longOnly,
    lb,
    ub,
    rf,
    shrinkageAlpha,
    nPoints,
    algorithmCache,
  } = store;

  const [algorithm,   setAlgorithm]   = useState<Algorithm>('markowitz');
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [optError,    setOptError]    = useState<string | null>(null);
  const [wasmMissing, setWasmMissing] = useState(false);
  const [btnPulse, setBtnPulse] = useState(false);

  // ── CVaR / Robust algorithm state ────────────────────────────────────────
  const [cvarConfidence, setCvarConfidence] = useState(0.95);
  const [robustGamma,    setRobustGamma]    = useState(0.1);

  // ── Black-Litterman state ────────────────────────────────────────────────
  const [blViews,        setBlViews]        = useState<BlViewRow[]>([]);
  const [blTau,          setBlTau]          = useState(0.05);
  const [blMarketReturn, setBlMarketReturn] = useState<number | null>(null);
  const [blImpliedRets,  setBlImpliedRets]  = useState<Float64Array | null>(null);
  const [blPosteriorMu,  setBlPosteriorMu]  = useState<Float64Array | null>(null);

  // ── Hover state ───────────────────────────────────────────────────────────
  const [hoveredIdx,     setHoveredIdx]     = useState<number | null>(null);
  const [hoveredWeights, setHoveredWeights] = useState<Float64Array | null>(null);
  const [hoveredMetrics, setHoveredMetrics] = useState<HoverMetrics | null>(null);

  // ── Algorithm overlay toggles ─────────────────────────────────────────────
  const [visibleAlgorithms, setVisibleAlgorithms] = useState<Set<string>>(new Set());
  const runningRef = useRef<Set<string>>(new Set());

  // ── Apply localStorage defaults once on mount ────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const d = loadDefaults();
    store.setConstraints({
      rf:             d.rf,
      shrinkageAlpha: d.shrinkageAlpha,
      nPoints:        d.nPoints,
    });
    setFrequency(d.frequency);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync selectedIdx to bestIdx ──────────────────────────────────────────
  useEffect(() => {
    if (frontier?.bestIdx != null) setSelectedIdx(frontier.bestIdx);
    else if (frontier === null)    setSelectedIdx(null);
  }, [frontier]);

  // ── tRPC lazy query ──────────────────────────────────────────────────────
  type QueryInput = { tickers: string[]; start: string; end: string; interval: 'daily' | 'weekly' | 'monthly' };
  const [queryInput, setQueryInput] = useState<QueryInput | null>(null);

  const {
    data:       pricesData,
    isFetching: isFetchingPrices,
    error:      fetchError,
  } = api.data.fetchPrices.useQuery(queryInput ?? skipToken);

  useEffect(() => {
    if (!pricesData) return;
    store.setPriceData({
      prices:   new Float64Array(pricesData.values),
      dates:    pricesData.dates,
      nPeriods: pricesData.n_periods,
      nAssets:  pricesData.n_assets,
    });
    store.setTickers(pricesData.tickers);
    setVisibleAlgorithms(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricesData]);

  // ── WASM engine ──────────────────────────────────────────────────────────
  const engine = useEngine();
  const ppy    = PPY[frequency] ?? 252;
  const hasData = nPeriods > 0 && !!returns;
  const nRetPeriods = returns && nAssets > 0 ? Math.floor(returns.length / nAssets) : 0;

  const autoMarketReturn = useMemo(() => {
    if (!returns || nRetPeriods === 0 || nAssets === 0) return 0.07;
    const ew = new Array<number>(nAssets).fill(1 / nAssets);
    return portfolioStats(returns, nRetPeriods, nAssets, ew, rf, ppy).ret;
  }, [returns, nRetPeriods, nAssets, rf, ppy]);

  const effectiveMarketReturn = blMarketReturn ?? autoMarketReturn;

  // ── Derived chart data ────────────────────────────────────────────────────
  const chartPoints = useMemo<FrontierPoint[]>(() => {
    if (frontier && frontier.nPoints > 0 && nAssets > 0) {
      return Array.from({ length: frontier.nPoints }, (_, i) => ({
        risk:    frontier.risks[i],
        return:  frontier.returns[i],
        sharpe:  frontier.sharpes[i],
        weights: Array.from(frontier.weights.slice(i * nAssets, (i + 1) * nAssets)),
      }));
    }
    if (currentWeights && returns && nRetPeriods > 0) {
      const w = Array.from(currentWeights);
      const s = portfolioStats(returns, nRetPeriods, nAssets, w, rf, ppy);
      return [{ risk: s.vol, return: s.ret, sharpe: s.sharpe, weights: w }];
    }
    return [];
  }, [frontier, currentWeights, returns, nPeriods, nAssets, rf, ppy]);

  const assetStats = useMemo<AssetStat[]>(() => {
    if (!returns || nRetPeriods === 0 || storeTickers.length === 0) return [];
    return computeAssetStats(returns, nRetPeriods, nAssets, storeTickers, ppy);
  }, [returns, nPeriods, nAssets, storeTickers, ppy]);

  const algorithmMarkers = useMemo<AlgorithmMarker[]>(() => {
    return OVERLAY_ALGORITHMS
      .filter((name) => algorithmCache[name])
      .map((name) => {
        const e = algorithmCache[name]!;
        return { algorithm: name as AlgorithmMarker['algorithm'], vol: e.vol, ret: e.ret, sharpe: e.sharpe };
      });
  }, [algorithmCache]);

  const displayWeights = useMemo<number[] | null>(() => {
    if (hoveredWeights) return Array.from(hoveredWeights);
    if (frontier && selectedIdx != null) {
      return Array.from(frontier.weights.slice(selectedIdx * nAssets, (selectedIdx + 1) * nAssets));
    }
    if (currentWeights) return Array.from(currentWeights);
    return null;
  }, [hoveredWeights, frontier, selectedIdx, nAssets, currentWeights]);

  const metrics = useMemo(() => {
    if (hoveredMetrics) return hoveredMetrics;
    if (frontier && selectedIdx != null && selectedIdx < frontier.nPoints) {
      return { ret: frontier.returns[selectedIdx], vol: frontier.risks[selectedIdx], sharpe: frontier.sharpes[selectedIdx] };
    }
    if (chartPoints.length === 1) {
      return { ret: chartPoints[0].return, vol: chartPoints[0].risk, sharpe: chartPoints[0].sharpe };
    }
    return null;
  }, [hoveredMetrics, frontier, selectedIdx, chartPoints]);

  const maxDrawdown = useMemo<number | null>(() => {
    if (!displayWeights || !returns || nRetPeriods === 0 || nAssets === 0) return null;
    return computeMaxDrawdown(returns, nRetPeriods, nAssets, displayWeights);
  }, [displayWeights, returns, nRetPeriods, nAssets]);

  // ── Handlers ────────────────────────────────────────────────────────────
  function handleLoadData() {
    if (localTickers.length === 0) return;
    store.setLoadingData(true);
    setQueryInput({ tickers: localTickers, start: startDate, end: endDate, interval: frequency });
  }

  function handlePresetChange(value: string) {
    setPreset(value);
    if (value !== 'custom' && PRESETS[value]) {
      setLocalTickers(PRESETS[value]!);
    }
  }

  const handlePointHover = useCallback(
    (index: number | null, weights: Float64Array | null, hMetrics: HoverMetrics | null) => {
      setHoveredIdx(index);
      setHoveredWeights(weights);
      setHoveredMetrics(hMetrics);
    },
    [],
  );

  const handlePointSelect = useCallback(
    (index: number | null) => {
      setSelectedIdx(index);
      if (index != null && frontier) {
        store.setWeights(frontier.weights.slice(index * nAssets, (index + 1) * nAssets));
      }
    },
    [frontier, nAssets, store],
  );

  const handleToggleAlgorithm = useCallback(
    async (name: string) => {
      const next = new Set(visibleAlgorithms);
      if (next.has(name)) { next.delete(name); setVisibleAlgorithms(next); return; }
      next.add(name);
      setVisibleAlgorithms(next);
      if (algorithmCache[name] || runningRef.current.has(name)) return;
      if (!returns || !hasData) return;
      runningRef.current.add(name);
      try {
        let weights: Float64Array | null = null;
        switch (name as OverlayAlgorithm) {
          case 'hrp':         weights = await engine.solveHrp(returns, nRetPeriods, nAssets, storeTickers); break;
          case 'risk_parity': { const cov = computeCovariance(returns, nRetPeriods, nAssets); weights = await engine.solveRiskParity(cov, nAssets, lb, ub); break; }
          case 'cvar':        weights = await engine.solveCvar(returns, nRetPeriods, nAssets, cvarConfidence, longOnly, lb, ub); break;
          case 'robust':      weights = await engine.solveRobust(returns, nRetPeriods, nAssets, robustGamma, longOnly, lb, ub, ppy); break;
        }
        if (weights) {
          const stats = portfolioStats(returns, nRetPeriods, nAssets, weights, rf, ppy);
          store.setCachedAlgorithm(name, { weights, vol: stats.vol, ret: stats.ret, sharpe: stats.sharpe });
        }
      } catch {
        next.delete(name);
        setVisibleAlgorithms(new Set(next));
      } finally {
        runningRef.current.delete(name);
      }
    },
    [visibleAlgorithms, algorithmCache, returns, hasData, nPeriods, nAssets, storeTickers, lb, ub, longOnly, rf, ppy, engine, store, cvarConfidence, robustGamma],
  );

  async function handleOptimize() {
    if (!returns || !hasData) return;
    setOptError(null);
    setWasmMissing(false);
    store.setOptimizing(true);
    store.setActiveAlgorithm(algorithm);
    try {
      switch (algorithm) {
        case 'markowitz': {
          const result = await engine.solveFrontier({ returns, nPeriods: nRetPeriods, nAssets, nPts: nPoints, longOnly, lb, ub, rf, ppy });
          store.setFrontier(result);
          if (result.bestIdx != null) store.setWeights(result.weights.slice(result.bestIdx * nAssets, (result.bestIdx + 1) * nAssets));
          break;
        }
        case 'hrp': {
          const w = await engine.solveHrp(returns, nRetPeriods, nAssets, storeTickers);
          store.setWeights(w); store.setFrontier(null); break;
        }
        case 'risk_parity': {
          const cov = computeCovariance(returns, nRetPeriods, nAssets);
          const w   = await engine.solveRiskParity(cov, nAssets, lb, ub);
          store.setWeights(w); store.setFrontier(null); break;
        }
        case 'cvar': {
          const w = await engine.solveCvar(returns, nRetPeriods, nAssets, cvarConfidence, longOnly, lb, ub);
          store.setWeights(w); store.setFrontier(null); break;
        }
        case 'robust': {
          const w = await engine.solveRobust(returns, nRetPeriods, nAssets, robustGamma, longOnly, lb, ub, ppy);
          store.setWeights(w); store.setFrontier(null); break;
        }
        case 'black_litterman': {
          const cov = computeCovariance(returns, nRetPeriods, nAssets);
          const marketWeights = new Float64Array(nAssets).fill(1 / nAssets);
          const viewInputs = blViews.map((v) =>
            v.direction === 'returns'
              ? { assetIndices: [v.assetIdx], weights: [1.0], expectedReturn: v.expectedReturn / 100, confidence: v.confidence }
              : { assetIndices: [v.assetIdx, v.targetAssetIdx], weights: [1.0, -1.0], expectedReturn: v.expectedReturn / 100, confidence: v.confidence }
          );
          const result = await engine.solveBlackLitterman(cov, nAssets, marketWeights, rf, effectiveMarketReturn, viewInputs, blTau, longOnly, lb, ub, nPoints);
          store.setFrontier(result);
          setBlImpliedRets(result.impliedReturns);
          setBlPosteriorMu(result.posteriorMu);
          if (result.bestIdx != null) store.setWeights(result.weights.slice(result.bestIdx * nAssets, (result.bestIdx + 1) * nAssets));
          break;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('WASM engine not loaded')) setWasmMissing(true);
      else setOptError(msg);
    } finally {
      store.setOptimizing(false);
    }
  }

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useKeyboard([
    {
      key: 'Enter', meta: true, ignoreInputs: false,
      handler: () => {
        if (!hasData || isOptimizing) return;
        // Pulse the button for keyboard feedback (respects prefers-reduced-motion)
        const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!reduced) {
          setBtnPulse(true);
          setTimeout(() => setBtnPulse(false), 200);
        }
        void handleOptimize();
      },
    },
    ...ALGORITHM_TABS.map((tab, i) => ({
      key: String(i + 1),
      handler: () => setAlgorithm(tab.value as Algorithm),
      ignoreInputs: true,
    })),
  ]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      className="slide-enter-content"
      style={{
        height: 'calc(100vh - 88px)',
        display: 'flex',
        gap: 24,
        overflow: 'hidden',
      }}
    >

      {/* ══ LEFT PANEL ══════════════════════════════════════════════════════ */}
      <aside
        style={{
          width: 320,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRight: '1px solid var(--border-subtle)',
        }}
      >
        {/* Scrollable sections */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

          {/* ── Universe ─────────────────────────────────────────────── */}
          <PanelSection title="Universe">
            <div className="flex flex-col gap-2">
              <ChipInput
                tickers={localTickers}
                onAdd={(t) => { setLocalTickers((p) => [...p, t]); setPreset('custom'); }}
                onRemove={(t) => { setLocalTickers((p) => p.filter((x) => x !== t)); setPreset('custom'); }}
              />
              {hasData && (
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-tertiary)' }}>
                  {nAssets} assets · {nPeriods.toLocaleString()} trading days
                </p>
              )}
              {fetchError && (
                <p className="text-[12px] text-negative">{fetchError.message ?? String(fetchError)}</p>
              )}
              <Select
                value={preset}
                onValueChange={handlePresetChange}
                options={PRESET_OPTIONS}
                className="w-full"
              />
            </div>
          </PanelSection>

          {/* ── Period ───────────────────────────────────────────────── */}
          <PanelSection title="Period">
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  variant="mono"
                  className="flex-1"
                />
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  variant="mono"
                  className="flex-1"
                />
              </div>
              <SegmentedControl
                options={[
                  { value: 'daily',   label: FREQ_LABELS.daily   },
                  { value: 'weekly',  label: FREQ_LABELS.weekly  },
                  { value: 'monthly', label: FREQ_LABELS.monthly },
                ]}
                value={frequency}
                onChange={(v) => setFrequency(v as typeof frequency)}
              />
              <Button
                variant="secondary"
                size="md"
                loading={isFetchingPrices}
                onClick={handleLoadData}
                className="w-full"
              >
                {isFetchingPrices ? 'Loading…' : 'Load Data'}
              </Button>
            </div>
          </PanelSection>

          {/* ── Algorithm ────────────────────────────────────────────── */}
          <PanelSection title="Algorithm">
            <div className="-mx-4 -mb-4">
              <AlgoList value={algorithm} onChange={setAlgorithm} />
            </div>
          </PanelSection>

          {/* ── Constraints (algorithm-adaptive) ─────────────────── */}
          <PanelSection title="Constraints" defaultOpen={true}>
            <div className="flex flex-col gap-3">

              {/* Always shown */}
              <ConstraintRow label="Long only">
                <Switch
                  checked={longOnly}
                  onCheckedChange={() => store.setConstraints({ longOnly: !longOnly })}
                />
              </ConstraintRow>

              <Slider
                label="Lower bound"
                value={lb}
                min={0}
                max={0.5}
                step={0.01}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onChange={(v) => store.setConstraints({ lb: v })}
              />

              <Slider
                label="Upper bound"
                value={ub}
                min={0.1}
                max={1.0}
                step={0.01}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onChange={(v) => store.setConstraints({ ub: v })}
              />

              {/* MVO + Robust + B-L */}
              {(algorithm === 'markowitz' || algorithm === 'robust' || algorithm === 'black_litterman') && (
                <ConstraintRow label="Risk-free rate">
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      variant="mono"
                      min={0}
                      max={0.2}
                      step={0.001}
                      value={rf}
                      onChange={(e) => store.setConstraints({ rf: parseFloat(e.target.value) || 0 })}
                      className="w-20 h-7 text-[12px]"
                    />
                    <span className="text-[12px] text-tertiary">%</span>
                  </div>
                </ConstraintRow>
              )}

              {/* MVO only: Shrinkage */}
              {algorithm === 'markowitz' && (
                <Slider
                  label="Shrinkage α"
                  value={shrinkageAlpha}
                  min={0}
                  max={1}
                  step={0.05}
                  format={(v) => v.toFixed(2)}
                  onChange={(v) => store.setConstraints({ shrinkageAlpha: v })}
                />
              )}

              {/* CVaR only: Confidence level */}
              {algorithm === 'cvar' && (
                <ConstraintRow label="Confidence level">
                  <SegmentedControl
                    options={[
                      { value: '0.9',  label: '90%' },
                      { value: '0.95', label: '95%' },
                      { value: '0.99', label: '99%' },
                    ]}
                    value={String(cvarConfidence)}
                    onChange={(v) => setCvarConfidence(Number(v))}
                  />
                </ConstraintRow>
              )}

              {/* Robust only: Uncertainty radius */}
              {algorithm === 'robust' && (
                <Slider
                  label="Uncertainty radius"
                  value={robustGamma}
                  min={0}
                  max={0.5}
                  step={0.05}
                  format={(v) => v.toFixed(2)}
                  onChange={setRobustGamma}
                />
              )}

              {/* MVO + CVaR + Robust + B-L: Frontier points */}
              {(algorithm === 'markowitz' || algorithm === 'cvar' || algorithm === 'robust' || algorithm === 'black_litterman') && (
                <Slider
                  label="Frontier points"
                  value={nPoints}
                  min={10}
                  max={100}
                  step={5}
                  format={(v) => String(Math.round(v))}
                  onChange={(v) => store.setConstraints({ nPoints: v })}
                />
              )}

              {/* B-L only: Tau + Market return */}
              {algorithm === 'black_litterman' && (
                <>
                  <Slider
                    label="Prior uncertainty (τ)"
                    value={blTau}
                    min={0.01}
                    max={0.20}
                    step={0.01}
                    format={(v) => v.toFixed(2)}
                    onChange={setBlTau}
                  />
                  <ConstraintRow label="Market return">
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        variant="mono"
                        step={0.1}
                        placeholder={`${(autoMarketReturn * 100).toFixed(1)}`}
                        value={blMarketReturn !== null ? (blMarketReturn * 100).toFixed(1) : ''}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          setBlMarketReturn(isNaN(v) ? null : v / 100);
                        }}
                        className="w-20 h-7 text-[12px]"
                      />
                      <span className="text-[12px] text-tertiary">%</span>
                    </div>
                  </ConstraintRow>
                </>
              )}

            </div>
          </PanelSection>

          {/* ── B-L Views (separate section) ─────────────────────── */}
          {algorithm === 'black_litterman' && (
            <PanelSection title="Views" defaultOpen={true}>
              <div className="flex flex-col gap-2">
                {blViews.length === 0 ? (
                  <p className="text-[12px] text-tertiary">No views — pure equilibrium</p>
                ) : (
                  blViews.map((view, vi) => (
                    <BlViewItem
                      key={view.id}
                      view={view}
                      tickers={storeTickers}
                      nAssets={nAssets}
                      onUpdate={(patch) =>
                        setBlViews((prev) => prev.map((v, i) => (i === vi ? { ...v, ...patch } : v)))
                      }
                      onDelete={() => setBlViews((prev) => prev.filter((_, i) => i !== vi))}
                    />
                  ))
                )}
                <button
                  type="button"
                  disabled={nAssets < 1}
                  onClick={() =>
                    setBlViews((prev) => [
                      ...prev,
                      { id: Math.random().toString(36).slice(2), assetIdx: 0, direction: 'returns', targetAssetIdx: Math.min(1, nAssets - 1), expectedReturn: 10, confidence: 0.5 },
                    ])
                  }
                  className="text-[12px] text-accent hover:text-accent-hover transition-colors disabled:opacity-40"
                >
                  + Add view
                </button>
              </div>
            </PanelSection>
          )}

        </div>{/* end scrollable sections */}

        {/* ── Action — sticky footer ─────────────────────────────────── */}
        <div
          style={{
            flexShrink: 0,
            borderTop: '1px solid var(--border-subtle)',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <Button
            variant="primary"
            size="lg"
            loading={isOptimizing}
            disabled={!hasData}
            onClick={handleOptimize}
            className="w-full"
            style={{
              transform: btnPulse ? 'scale(0.97)' : 'scale(1)',
              transition: btnPulse
                ? 'transform 100ms ease-out'
                : 'transform 100ms ease-out',
            }}
          >
            {isOptimizing ? 'Optimizing…' : 'Optimize'}
          </Button>
          <p
            className="text-center select-none"
            style={{ fontSize: 11, color: 'var(--text-tertiary)' }}
          >
            ⌘↵ to optimize
          </p>
          {!hasData && !isFetchingPrices && (
            <p className="text-center text-[11px] text-tertiary">Load data first</p>
          )}
        </div>
      </aside>

      {/* ══ RIGHT PANEL ═════════════════════════════════════════════════════ */}
      <div
        style={{ flex: 1, minWidth: 0, overflowY: 'auto', paddingBottom: 32 }}
        className="flex flex-col gap-5"
      >
        {/* Error banners */}
        <AnimatePresence>
          {wasmMissing && (
            <motion.div
              key="wasm-banner"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              className="rounded border border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.07)] px-4 py-3 text-[13px] text-warning"
            >
              <span className="font-medium">WASM engine not built.</span>{' '}
              Run{' '}
              <code className="mono rounded bg-[var(--surface)] px-1.5 py-0.5 text-[11px]">
                bash scripts/build-wasm.sh
              </code>{' '}
              from the repo root, then reload.
            </motion.div>
          )}
          {optError && (
            <motion.div
              key="opt-error"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              className="rounded border border-[rgba(239,68,68,0.25)] bg-[var(--negative-subtle)] px-4 py-3 text-[13px] text-negative"
            >
              <span className="font-medium">Optimisation failed:</span> {optError}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Efficient Frontier — full width, transparent bg, 480px tall */}
        <EfficientFrontier
          points={chartPoints}
          bestIdx={frontier ? (frontier.bestIdx ?? undefined) : undefined}
          tickers={storeTickers}
          rf={rf}
          height={480}
          assetStats={assetStats.length > 0 ? assetStats : undefined}
          algorithmMarkers={algorithmMarkers}
          visibleAlgorithms={visibleAlgorithms}
          selectedIdx={selectedIdx}
          onPointHover={handlePointHover}
          onPointSelect={handlePointSelect}
          onToggleAlgorithm={hasData ? handleToggleAlgorithm : undefined}
          pointMode={POINT_MODE_ALGORITHMS.has(algorithm)}
          pointModeLabel={POINT_MODE_LABELS[algorithm] ?? ''}
        />

        {/* B-L hero: implied vs posterior — full width, above metrics */}
        {algorithm === 'black_litterman' && blImpliedRets && blPosteriorMu && storeTickers.length > 0 && (
          <div
            style={{
              padding: '20px 0',
              borderTop: '1px solid var(--border-subtle)',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <BlReturnsChart
              tickers={storeTickers}
              implied={blImpliedRets}
              posterior={blPosteriorMu}
              views={blViews}
            />
          </div>
        )}

        {/* Portfolio metrics strip — hidden until data is loaded */}
        {hasData && (
          <MetricsStrip
            entries={[
              {
                label: 'Return',
                sublabel: 'annualized',
                value: metrics?.ret != null
                  ? `${metrics.ret >= 0 ? '+' : ''}${(metrics.ret * 100).toFixed(2)}%`
                  : '—',
                color: metrics?.ret != null
                  ? (metrics.ret >= 0 ? 'var(--positive)' : 'var(--negative)')
                  : 'var(--text-tertiary)',
              },
              {
                label: 'Volatility',
                sublabel: 'annualized',
                value: metrics?.vol != null ? `${(metrics.vol * 100).toFixed(2)}%` : '—',
                color: metrics?.vol != null ? '#EDEDEE' : 'var(--text-tertiary)',
              },
              {
                label: 'Sharpe',
                sublabel: 'risk-adjusted',
                value: metrics?.sharpe != null ? metrics.sharpe.toFixed(3) : '—',
                color: metrics?.sharpe != null
                  ? (metrics.sharpe > 0.8 ? 'var(--positive)' : metrics.sharpe >= 0.5 ? 'var(--text-primary)' : 'var(--warning)')
                  : 'var(--text-tertiary)',
              },
              {
                label: 'Max Drawdown',
                sublabel: 'historical',
                value: maxDrawdown != null ? `-${(maxDrawdown * 100).toFixed(2)}%` : '—',
                color: maxDrawdown != null ? '#EF4444' : 'var(--text-tertiary)',
              },
            ]}
          />
        )}

        {/* Weight allocation — full-width, hidden until data is loaded */}
        {hasData && storeTickers.length > 0 && (
          <div>
            <p className="text-h3 text-tertiary mb-3">
              Weight Allocation
              {hoveredIdx != null && (
                <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-tertiary)', marginLeft: 8 }}>
                  — hovering
                </span>
              )}
            </p>
            {/* Show empty bars before first optimisation, real bars after */}
            <WeightBar
              weights={displayWeights ?? new Array(storeTickers.length).fill(0)}
              tickers={storeTickers}
              longOnly={longOnly}
            />
          </div>
        )}
      </div>

    </div>
  );
}
