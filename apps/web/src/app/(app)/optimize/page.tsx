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
  { value: 'markowitz',       label: 'MVO'    },
  { value: 'hrp',             label: 'HRP'    },
  { value: 'risk_parity',     label: 'ERC'    },
  { value: 'cvar',            label: 'CVaR'   },
  { value: 'robust',          label: 'Robust' },
  { value: 'black_litterman', label: 'B-L'    },
];

const OVERLAY_ALGORITHMS = ['hrp', 'risk_parity', 'cvar', 'robust'] as const;
type OverlayAlgorithm = typeof OVERLAY_ALGORITHMS[number];

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

function AlgoTabs({
  value,
  onChange,
}: {
  value: Algorithm;
  onChange: (v: Algorithm) => void;
}) {
  return (
    <div className="flex flex-wrap border-b border-[var(--border-subtle)]">
      {ALGORITHM_TABS.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value as Algorithm)}
          className={[
            'relative px-3 py-2 text-[12px] font-medium transition-colors',
            'duration-[var(--duration-micro)] outline-none select-none whitespace-nowrap',
            'after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:content-[""]',
            'after:transition-colors after:duration-[var(--duration-micro)]',
            value === tab.value
              ? 'text-primary after:bg-accent'
              : 'text-secondary hover:text-primary after:bg-transparent',
          ].join(' ')}
        >
          {tab.label}
        </button>
      ))}
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
// B-L posterior vs implied returns chart (unchanged)
// ---------------------------------------------------------------------------

function BlReturnsChart({
  tickers,
  implied,
  posterior,
}: {
  tickers: string[];
  implied: Float64Array;
  posterior: Float64Array;
}) {
  const n = tickers.length;
  let maxAbs = 1e-12;
  for (let i = 0; i < n; i++) {
    maxAbs = Math.max(maxAbs, Math.abs(implied[i] ?? 0), Math.abs(posterior[i] ?? 0));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-4 mb-1">
        <span className="flex items-center gap-1.5 text-[11px] text-tertiary">
          <span className="inline-block w-3 h-1.5 rounded-sm bg-[var(--border-strong)]" />
          Implied
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-tertiary">
          <span className="inline-block w-3 h-1.5 rounded-sm bg-accent" />
          Posterior
        </span>
      </div>
      {tickers.map((ticker, i) => {
        const imp  = (implied[i]   ?? 0) * 100;
        const post = (posterior[i] ?? 0) * 100;
        const impW  = Math.abs(implied[i]   ?? 0) / maxAbs;
        const postW = Math.abs(posterior[i] ?? 0) / maxAbs;
        const postColor = post > imp ? 'var(--positive)' : post < imp ? 'var(--negative)' : 'var(--accent)';
        return (
          <div key={ticker} className="grid grid-cols-[56px_1fr_52px] items-center gap-2">
            <span className="mono text-[11px] text-secondary truncate">{ticker}</span>
            <div className="flex flex-col gap-0.5">
              <div className="h-1.5 rounded-sm bg-[var(--surface)] overflow-hidden">
                <div className="h-full rounded-sm bg-[var(--border-strong)]" style={{ width: `${(impW * 100).toFixed(1)}%` }} />
              </div>
              <div className="h-1.5 rounded-sm bg-[var(--surface)] overflow-hidden">
                <div className="h-full rounded-sm" style={{ width: `${(postW * 100).toFixed(1)}%`, background: postColor }} />
              </div>
            </div>
            <div className="text-right">
              <span className="mono text-[10px] text-tertiary">{post.toFixed(1)}%</span>
            </div>
          </div>
        );
      })}
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
          case 'cvar':        weights = await engine.solveCvar(returns, nRetPeriods, nAssets, 0.95, longOnly, lb, ub); break;
          case 'robust':      weights = await engine.solveRobust(returns, nRetPeriods, nAssets, 1.0, longOnly, lb, ub, ppy); break;
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
    [visibleAlgorithms, algorithmCache, returns, hasData, nPeriods, nAssets, storeTickers, lb, ub, longOnly, rf, ppy, engine, store],
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
          const w = await engine.solveCvar(returns, nRetPeriods, nAssets, 0.95, longOnly, lb, ub);
          store.setWeights(w); store.setFrontier(null); break;
        }
        case 'robust': {
          const w = await engine.solveRobust(returns, nRetPeriods, nAssets, 1.0, longOnly, lb, ub, ppy);
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
    { key: 'Enter', meta: true, handler: () => { if (hasData && !isOptimizing) void handleOptimize(); }, ignoreInputs: false },
    ...ALGORITHM_TABS.map((tab, i) => ({
      key: String(i + 1),
      handler: () => setAlgorithm(tab.value as Algorithm),
      ignoreInputs: true,
    })),
  ]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        height: 'calc(100vh - 88px)',
        display: 'flex',
        gap: 24,
        overflow: 'hidden',
      }}
    >

      {/* ══ LEFT PANEL ══════════════════════════════════════════════════════ */}
      <aside
        data-animate
        style={{
          width: 320,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRight: '1px solid var(--border-subtle)',
          '--stagger': 1,
          '--delay': '100ms',
        } as React.CSSProperties}
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
            <div className="-mx-4 -mt-1">
              <AlgoTabs value={algorithm} onChange={setAlgorithm} />
            </div>
          </PanelSection>

          {/* ── Constraints ──────────────────────────────────────────── */}
          <PanelSection title="Constraints" defaultOpen={true}>
            <div className="flex flex-col gap-3">

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

              <Slider
                label="Shrinkage α"
                value={shrinkageAlpha}
                min={0}
                max={1}
                step={0.05}
                format={(v) => v.toFixed(2)}
                onChange={(v) => store.setConstraints({ shrinkageAlpha: v })}
              />

              {(algorithm === 'markowitz' || algorithm === 'black_litterman') && (
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

              {/* ── Black-Litterman extras ─────────────────────────── */}
              {algorithm === 'black_litterman' && (
                <>
                  <div className="pt-2 -mx-4 px-4 border-t border-[var(--border-subtle)]">
                    <p className="text-h3 text-tertiary mb-3">Views</p>
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
                  </div>

                  <div className="pt-2 -mx-4 px-4 border-t border-[var(--border-subtle)]">
                    <p className="text-h3 text-tertiary mb-3">B-L Parameters</p>
                    <div className="flex flex-col gap-3">
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
                    </div>
                  </div>
                </>
              )}
            </div>
          </PanelSection>

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
        data-animate
        style={{ flex: 1, minWidth: 0, overflowY: 'auto', paddingBottom: 32, '--stagger': 2, '--delay': '100ms' } as React.CSSProperties}
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
        />

        {/* B-L posterior vs implied */}
        {algorithm === 'black_litterman' && blImpliedRets && blPosteriorMu && storeTickers.length > 0 && (
          <Card padding="md">
            <p className="mb-4 text-h3 text-tertiary">Expected Returns — Implied vs Posterior</p>
            <BlReturnsChart tickers={storeTickers} implied={blImpliedRets} posterior={blPosteriorMu} />
          </Card>
        )}

        {/* Weight Allocation (60%) + Portfolio Metrics (40%) */}
        <div style={{ display: 'flex', gap: 20 }}>

          {/* Weight allocation */}
          <div style={{ flex: '0 0 calc(60% - 10px)', minWidth: 0 }}>
            <p className="text-h3 text-tertiary mb-4">
              Weight Allocation
              {hoveredIdx != null && (
                <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-tertiary)', marginLeft: 8 }}>
                  — hovering
                </span>
              )}
            </p>
            {displayWeights && storeTickers.length > 0 ? (
              <WeightBar weights={displayWeights} tickers={storeTickers} />
            ) : (
              <p className="text-[13px] text-tertiary">
                {hasData ? 'Run optimisation to see weights' : 'Load data first'}
              </p>
            )}
          </div>

          {/* Portfolio metrics */}
          <div style={{ flex: '0 0 calc(40% - 10px)', minWidth: 0 }}>
            <p className="text-h3 text-tertiary mb-4">Portfolio Metrics</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <MetricCard
                label="Return"
                value={metrics?.ret != null
                  ? `${metrics.ret >= 0 ? '+' : ''}${(metrics.ret * 100).toFixed(2)}%`
                  : '—'}
                color={metrics?.ret != null
                  ? (metrics.ret >= 0 ? 'positive' : 'negative')
                  : undefined}
              />
              <MetricCard
                label="Volatility"
                value={metrics?.vol != null
                  ? `${(metrics.vol * 100).toFixed(2)}%`
                  : '—'}
              />
              <MetricCard
                label="Sharpe"
                value={metrics?.sharpe != null ? metrics.sharpe.toFixed(3) : '—'}
                color={metrics?.sharpe != null
                  ? (metrics.sharpe > 1.0 ? 'positive' : metrics.sharpe >= 0.5 ? undefined : 'warning')
                  : undefined}
              />
            </div>
          </div>

        </div>
      </div>

    </div>
  );
}
