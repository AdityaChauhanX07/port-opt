'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { skipToken } from '@tanstack/react-query';
import { EfficientFrontier, WeightBar } from '@portopt/charts';
import type { FrontierPoint } from '@portopt/charts';
import { Button, Card, Input, Select, Slider, Tabs, TabsPrimitive } from '@portopt/ui';
import { api } from '../../../lib/trpc/client';
import { usePortfolioStore } from '../../../lib/stores/portfolio';
import { useEngine } from '../../../lib/wasm/use-engine';
import { slideUp, stagger } from '../../../lib/motion';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TICKERS = 'AAPL, MSFT, TLT, GLD, IWM, SPY';

function defaultDateRange() {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 5);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

const PPY: Record<string, number> = { daily: 252, weekly: 52, monthly: 12 };

const FREQUENCY_OPTIONS = [
  { value: 'daily',   label: 'Daily' },
  { value: 'weekly',  label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

// ---------------------------------------------------------------------------
// Math helpers
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
        s +=
          (returns[t * nAssets + a] - means[a]) *
          (returns[t * nAssets + b] - means[b]);
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
  weights: number[],
  rf: number,
  ppy: number,
) {
  let sumR = 0, sumR2 = 0;
  for (let t = 0; t < nPeriods; t++) {
    let r = 0;
    for (let a = 0; a < nAssets; a++) r += weights[a] * returns[t * nAssets + a];
    sumR += r;
    sumR2 += r * r;
  }
  const mean = sumR / nPeriods;
  const variance = (sumR2 - nPeriods * mean * mean) / Math.max(nPeriods - 1, 1);
  const vol = Math.sqrt(Math.max(variance, 0) * ppy);
  const ret = mean * ppy;
  const sharpe = vol > 0 ? (ret - rf) / vol : 0;
  return { ret, vol, sharpe };
}

// ---------------------------------------------------------------------------
// MetricCard
// ---------------------------------------------------------------------------

function MetricCard({
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
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { stiffness: 60, damping: 18 });
  const display = useTransform(spring, (v) => (value === null ? '—' : format(v)));

  useEffect(() => {
    if (value !== null) mv.set(value);
  }, [value, mv]);

  return (
    <div className="flex-1 min-w-0">
      <p className="mb-1 text-[11px] uppercase tracking-[0.06em] text-tertiary">
        {label}
      </p>
      <motion.p
        className={`mono text-[26px] font-semibold leading-none ${colorClass}`}
      >
        {display}
      </motion.p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Algorithm = 'markowitz' | 'hrp' | 'risk_parity' | 'cvar' | 'robust';

const ALGORITHM_TABS = [
  { value: 'markowitz',   label: 'MVO' },
  { value: 'hrp',         label: 'HRP' },
  { value: 'risk_parity', label: 'ERC' },
  { value: 'cvar',        label: 'CVaR' },
  { value: 'robust',      label: 'Robust' },
];

const containerVariants = stagger(0.06);

export default function OptimizePage() {
  // ── Local form state ─────────────────────────────────────────────────────
  const defaultRange = useMemo(defaultDateRange, []);
  const [tickerText, setTickerText]   = useState(DEFAULT_TICKERS);
  const [startDate,  setStartDate]    = useState(defaultRange.start);
  const [endDate,    setEndDate]      = useState(defaultRange.end);
  const [frequency,  setFrequency]    = useState<'daily' | 'weekly' | 'monthly'>('daily');

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
  } = store;

  const [algorithm, setAlgorithm]  = useState<Algorithm>('markowitz');
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [optError, setOptError]     = useState<string | null>(null);
  const [wasmMissing, setWasmMissing] = useState(false);

  // Sync selectedIdx to bestIdx when frontier updates
  useEffect(() => {
    if (frontier?.bestIdx != null) setSelectedIdx(frontier.bestIdx);
    else if (frontier === null)    setSelectedIdx(null);
  }, [frontier]);

  // ── tRPC lazy query ──────────────────────────────────────────────────────
  type QueryInput = {
    tickers: string[];
    start: string;
    end: string;
    interval: 'daily' | 'weekly' | 'monthly';
  };
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricesData]);

  // ── WASM engine ──────────────────────────────────────────────────────────
  const engine = useEngine();
  const ppy    = PPY[frequency] ?? 252;
  const hasData = nPeriods > 0 && !!returns;

  // ── Derived values ────────────────────────────────────────────────────────
  const chartPoints = useMemo<FrontierPoint[]>(() => {
    if (frontier && frontier.nPoints > 0 && nAssets > 0) {
      return Array.from({ length: frontier.nPoints }, (_, i) => ({
        risk:    frontier.risks[i],
        return:  frontier.returns[i],
        sharpe:  frontier.sharpes[i],
        weights: Array.from(frontier.weights.slice(i * nAssets, (i + 1) * nAssets)),
      }));
    }
    if (currentWeights && returns && nPeriods > 0) {
      const w = Array.from(currentWeights);
      const s = portfolioStats(returns, nPeriods, nAssets, w, rf, ppy);
      return [{ risk: s.vol, return: s.ret, sharpe: s.sharpe, weights: w }];
    }
    return [];
  }, [frontier, currentWeights, returns, nPeriods, nAssets, rf, ppy]);

  const displayWeights = useMemo<number[] | null>(() => {
    if (frontier && selectedIdx != null) {
      return Array.from(
        frontier.weights.slice(selectedIdx * nAssets, (selectedIdx + 1) * nAssets)
      );
    }
    if (currentWeights) return Array.from(currentWeights);
    return null;
  }, [frontier, selectedIdx, nAssets, currentWeights]);

  const metrics = useMemo(() => {
    if (frontier && selectedIdx != null && selectedIdx < frontier.nPoints) {
      return {
        ret:    frontier.returns[selectedIdx],
        vol:    frontier.risks[selectedIdx],
        sharpe: frontier.sharpes[selectedIdx],
      };
    }
    if (chartPoints.length === 1) {
      return { ret: chartPoints[0].return, vol: chartPoints[0].risk, sharpe: chartPoints[0].sharpe };
    }
    return null;
  }, [frontier, selectedIdx, chartPoints]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  function handleLoadData() {
    const tickers = tickerText
      .split(',')
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
    if (tickers.length === 0) return;
    store.setLoadingData(true);
    setQueryInput({ tickers, start: startDate, end: endDate, interval: frequency });
  }

  const handlePointClick = useCallback(
    (point: FrontierPoint, idx: number) => {
      setSelectedIdx(idx);
      store.setWeights(new Float64Array(point.weights));
    },
    [store],
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
          const result = await engine.solveFrontier({ returns, nPeriods, nAssets, nPts: nPoints, longOnly, lb, ub, rf, ppy });
          store.setFrontier(result);
          if (result.bestIdx != null) {
            store.setWeights(result.weights.slice(result.bestIdx * nAssets, (result.bestIdx + 1) * nAssets));
          }
          break;
        }
        case 'hrp': {
          const w = await engine.solveHrp(returns, nPeriods, nAssets, storeTickers);
          store.setWeights(w);
          store.setFrontier(null);
          break;
        }
        case 'risk_parity': {
          const cov = computeCovariance(returns, nPeriods, nAssets);
          const w   = await engine.solveRiskParity(cov, nAssets, lb, ub);
          store.setWeights(w);
          store.setFrontier(null);
          break;
        }
        case 'cvar': {
          const w = await engine.solveCvar(returns, nPeriods, nAssets, 0.95, longOnly, lb, ub);
          store.setWeights(w);
          store.setFrontier(null);
          break;
        }
        case 'robust': {
          const w = await engine.solveRobust(returns, nPeriods, nAssets, 1.0, longOnly, lb, ub, ppy);
          store.setWeights(w);
          store.setFrontier(null);
          break;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('WASM engine not loaded')) {
        setWasmMissing(true);
      } else {
        setOptError(msg);
      }
    } finally {
      store.setOptimizing(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <motion.div
      className="flex h-full flex-col"
      initial="initial"
      animate="animate"
      variants={containerVariants}
    >
      {/* ── Controls bar ───────────────────────────────────────────────── */}
      <motion.div
        variants={slideUp}
        className="flex flex-wrap items-center gap-2 px-8 py-4 hairline-b"
      >
        <Input
          value={tickerText}
          onChange={(e) => setTickerText(e.target.value)}
          placeholder="AAPL, MSFT, TLT, …"
          className="min-w-[220px] flex-1"
          onKeyDown={(e) => e.key === 'Enter' && handleLoadData()}
        />

        <Input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="w-[138px]"
          variant="mono"
        />
        <span className="text-[11px] text-muted">–</span>
        <Input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="w-[138px]"
          variant="mono"
        />

        <Select
          value={frequency}
          onValueChange={(v) => setFrequency(v as typeof frequency)}
          options={FREQUENCY_OPTIONS}
          className="w-[110px]"
        />

        <Button
          variant="primary"
          size="md"
          loading={isFetchingPrices}
          onClick={handleLoadData}
        >
          {isFetchingPrices ? 'Loading' : 'Load Data'}
        </Button>

        {hasData && !isFetchingPrices && (
          <span className="mono text-[11px] text-muted">
            {nAssets}A · {nPeriods}T
          </span>
        )}
        {fetchError && (
          <span className="text-[12px] text-loss">
            {fetchError.message ?? String(fetchError)}
          </span>
        )}
      </motion.div>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Left panel ─────────────────────────────────────────────── */}
        <motion.aside
          variants={slideUp}
          className="flex w-[240px] shrink-0 flex-col overflow-y-auto hairline-r"
          style={{ background: 'var(--bg)' }}
        >
          {/* Algorithm tabs */}
          <div className="px-0">
            <Tabs
              tabs={ALGORITHM_TABS}
              value={algorithm}
              onValueChange={(v) => setAlgorithm(v as Algorithm)}
            />
          </div>

          {/* Constraints */}
          <div className="flex flex-col gap-5 p-5 flex-1">
            <SectionLabel>Constraints</SectionLabel>

            {/* Long only */}
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-secondary">Long only</span>
              <Toggle
                checked={longOnly}
                onChange={() => store.setConstraints({ longOnly: !longOnly })}
              />
            </div>

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

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-tertiary">Risk-free rate</span>
                <span className="mono text-[12px] text-primary">
                  {(rf * 100).toFixed(2)}%
                </span>
              </div>
              <Input
                type="number"
                variant="mono"
                min={0}
                max={0.2}
                step={0.001}
                value={rf}
                onChange={(e) =>
                  store.setConstraints({ rf: parseFloat(e.target.value) || 0 })
                }
                className="h-7 text-[12px]"
              />
            </div>

            <Slider
              label="Shrinkage α"
              value={shrinkageAlpha}
              min={0}
              max={1}
              step={0.05}
              format={(v) => v.toFixed(2)}
              onChange={(v) => store.setConstraints({ shrinkageAlpha: v })}
            />

            {algorithm === 'markowitz' && (
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
          </div>

          {/* Optimize button */}
          <div className="p-5 hairline-t">
            <Button
              variant="primary"
              size="lg"
              loading={isOptimizing}
              disabled={!hasData}
              onClick={handleOptimize}
              className="w-full"
            >
              {isOptimizing ? 'Computing' : 'Optimize'}
            </Button>
            {!hasData && (
              <p className="mt-2 text-center text-[11px] text-muted">
                Load data first
              </p>
            )}
          </div>
        </motion.aside>

        {/* ── Main area ──────────────────────────────────────────────── */}
        <motion.div
          variants={slideUp}
          className="flex flex-1 flex-col gap-6 overflow-y-auto p-8"
        >
          {/* Banners */}
          <AnimatePresence>
            {wasmMissing && (
              <motion.div
                key="wasm-banner"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                className="rounded border border-[rgba(248,177,73,0.25)] bg-[rgba(248,177,73,0.07)] px-4 py-3 text-[13px] text-[#f8b149]"
              >
                <span className="font-medium">WASM engine not built.</span>{' '}
                Run{' '}
                <code className="mono rounded bg-subtle px-1.5 py-0.5 text-[11px]">
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
                className="rounded border border-[rgba(248,81,73,0.25)] bg-loss-subtle px-4 py-3 text-[13px] text-loss"
              >
                <span className="font-medium">Optimisation failed:</span> {optError}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Efficient Frontier chart */}
          <motion.div variants={slideUp}>
            <Card padding="md" className="min-h-[360px] flex flex-col">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-[13px] font-medium text-primary">
                  Efficient Frontier
                </span>
                {frontier ? (
                  <span className="mono text-[11px] text-muted">
                    {frontier.nPoints} portfolios · click to select
                  </span>
                ) : currentWeights ? (
                  <span className="mono text-[11px] text-muted">
                    {ALGORITHM_TABS.find((a) => a.value === algorithm)?.label}
                  </span>
                ) : null}
              </div>
              <div className="flex-1 min-h-[280px]">
                <EfficientFrontier
                  points={chartPoints}
                  bestIdx={frontier ? (frontier.bestIdx ?? undefined) : undefined}
                  tickers={storeTickers}
                  selectedIdx={selectedIdx}
                  onPointClick={handlePointClick}
                />
              </div>
            </Card>
          </motion.div>

          {/* Weights + Metrics */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <motion.div variants={slideUp}>
              <Card padding="md">
                <p className="mb-4 text-[11px] uppercase tracking-[0.06em] text-tertiary">
                  Weight Allocation
                </p>
                {displayWeights && storeTickers.length > 0 ? (
                  <WeightBar weights={displayWeights} tickers={storeTickers} />
                ) : (
                  <p className="text-[13px] text-muted">
                    {hasData ? 'Run optimisation to see weights' : 'Load data first'}
                  </p>
                )}
              </Card>
            </motion.div>

            <motion.div variants={slideUp}>
              <Card padding="md">
                <p className="mb-5 text-[11px] uppercase tracking-[0.06em] text-tertiary">
                  Portfolio Metrics
                </p>
                <div className="flex gap-6 divide-x divide-[var(--border)]">
                  <MetricCard
                    label="Return"
                    value={metrics?.ret ?? null}
                    format={(v) => `${(v * 100).toFixed(2)}%`}
                    colorClass="text-gain"
                  />
                  <div className="flex-1 min-w-0 pl-6">
                    <MetricCard
                      label="Volatility"
                      value={metrics?.vol ?? null}
                      format={(v) => `${(v * 100).toFixed(2)}%`}
                      colorClass="text-primary"
                    />
                  </div>
                  <div className="flex-1 min-w-0 pl-6">
                    <MetricCard
                      label="Sharpe"
                      value={metrics?.sharpe ?? null}
                      format={(v) => v.toFixed(3)}
                      colorClass="text-accent"
                    />
                  </div>
                </div>
              </Card>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Small local helpers
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-[0.08em] text-muted">
      {children}
    </p>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={[
        'relative h-5 w-9 rounded-full transition-colors duration-[var(--duration)]',
        checked ? 'bg-accent' : 'bg-subtle border border-[var(--border-strong)]',
      ].join(' ')}
    >
      <span
        className={[
          'absolute top-0.5 h-4 w-4 rounded-full bg-white',
          'shadow-sm transition-transform duration-[var(--duration)]',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        ].join(' ')}
      />
    </button>
  );
}
