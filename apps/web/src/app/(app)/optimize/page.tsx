'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { skipToken } from '@tanstack/react-query';
import { EfficientFrontier, WeightBar } from '@portopt/charts';
import type { FrontierPoint } from '@portopt/charts';
import { api } from '../../../lib/trpc/client';
import { usePortfolioStore } from '../../../lib/stores/portfolio';
import { useEngine } from '../../../lib/wasm/use-engine';

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
  let sumR = 0,
    sumR2 = 0;
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
// Sub-components
// ---------------------------------------------------------------------------

/** Animated count-up metric card. */
function MetricCard({
  label,
  value,
  format,
  color = '#e5e5e5',
}: {
  label: string;
  value: number | null;
  format: (v: number) => string;
  color?: string;
}) {
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { stiffness: 60, damping: 18 });
  const display = useTransform(spring, (v) => (value === null ? '—' : format(v)));

  useEffect(() => {
    if (value !== null) mv.set(value);
  }, [value, mv]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex-1 rounded-xl border border-[#1e1e1e] bg-[#141414] p-4"
    >
      <p className="mb-1 text-xs font-medium uppercase tracking-widest text-[#555]">
        {label}
      </p>
      <motion.p
        className="text-2xl font-semibold tabular-nums"
        style={{ color }}
      >
        {display}
      </motion.p>
    </motion.div>
  );
}

/** Labelled slider control. */
function SliderField({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-[#777]">{label}</span>
        <span className="font-medium text-[#e5e5e5]">
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-[#2f81f7]"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Algorithm = 'markowitz' | 'hrp' | 'risk_parity' | 'cvar' | 'robust';

const ALGORITHMS: { id: Algorithm; label: string }[] = [
  { id: 'markowitz',   label: 'Markowitz MVO' },
  { id: 'hrp',         label: 'HRP' },
  { id: 'risk_parity', label: 'Risk Parity (ERC)' },
  { id: 'cvar',        label: 'Min-CVaR' },
  { id: 'robust',      label: 'Robust MVO' },
];

const stagger = {
  container: {
    animate: { transition: { staggerChildren: 0.08 } },
  },
  item: {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
  },
};

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

  // ── Selected algorithm (local — mirrors store) ───────────────────────────
  const [algorithm, setAlgorithm] = useState<Algorithm>('markowitz');

  // ── Selected frontier point ──────────────────────────────────────────────
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  // Sync selectedIdx to bestIdx when frontier updates
  useEffect(() => {
    if (frontier?.bestIdx != null) setSelectedIdx(frontier.bestIdx);
    else if (frontier === null)    setSelectedIdx(null);
  }, [frontier]);

  // ── Optimization error ───────────────────────────────────────────────────
  const [optError, setOptError] = useState<string | null>(null);

  // ── tRPC lazy query ──────────────────────────────────────────────────────
  type QueryInput = {
    tickers: string[];
    start: string;
    end: string;
    interval: 'daily' | 'weekly' | 'monthly';
  };
  const [queryInput, setQueryInput] = useState<QueryInput | null>(null);

  const {
    data:      pricesData,
    isFetching: isFetchingPrices,
    error:      fetchError,
  } = api.data.fetchPrices.useQuery(queryInput ?? skipToken);

  // When new price data arrives, push it into the store
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
  const [wasmMissing, setWasmMissing] = useState(false);

  // ── Derived values ───────────────────────────────────────────────────────
  const ppy = PPY[frequency] ?? 252;
  const hasData = nPeriods > 0 && !!returns;

  /** Convert flat frontier arrays to FrontierPoint[]. */
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

  /** Active display weights (selected frontier point or single optimisation). */
  const displayWeights = useMemo<number[] | null>(() => {
    if (frontier && selectedIdx != null) {
      return Array.from(
        frontier.weights.slice(selectedIdx * nAssets, (selectedIdx + 1) * nAssets)
      );
    }
    if (currentWeights) return Array.from(currentWeights);
    return null;
  }, [frontier, selectedIdx, nAssets, currentWeights]);

  /** Metrics for the currently selected point. */
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

  // ── Handlers ─────────────────────────────────────────────────────────────

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
          const result = await engine.solveFrontier({
            returns,
            nPeriods,
            nAssets,
            nPts:     nPoints,
            longOnly,
            lb,
            ub,
            rf,
            ppy,
          });
          store.setFrontier(result);
          if (result.bestIdx != null) {
            store.setWeights(
              result.weights.slice(
                result.bestIdx * nAssets,
                (result.bestIdx + 1) * nAssets,
              ),
            );
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
          const w = await engine.solveCvar(
            returns, nPeriods, nAssets, 0.95, longOnly, lb, ub,
          );
          store.setWeights(w);
          store.setFrontier(null);
          break;
        }
        case 'robust': {
          const w = await engine.solveRobust(
            returns, nPeriods, nAssets, 1.0, longOnly, lb, ub, ppy,
          );
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
      className="flex h-screen flex-col overflow-hidden bg-[#0a0a0a] text-[#e5e5e5]"
      initial="initial"
      animate="animate"
      variants={stagger.container}
    >
      {/* ── TOP BAR ─────────────────────────────────────────────────────── */}
      <motion.div
        variants={stagger.item}
        className="flex flex-wrap items-center gap-3 border-b border-[#1e1e1e] bg-[#0d0d0d] px-4 py-3"
      >
        {/* Ticker input */}
        <input
          type="text"
          value={tickerText}
          onChange={(e) => setTickerText(e.target.value)}
          placeholder="AAPL, MSFT, TLT, ..."
          className="min-w-[240px] flex-1 rounded-lg border border-[#1e1e1e] bg-[#141414] px-3 py-2 text-sm text-[#e5e5e5] placeholder-[#444] outline-none focus:border-[#2f81f7] transition-colors"
        />

        {/* Start date */}
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="rounded-lg border border-[#1e1e1e] bg-[#141414] px-3 py-2 text-sm text-[#e5e5e5] outline-none focus:border-[#2f81f7] transition-colors"
        />
        <span className="text-[#444] text-xs">→</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="rounded-lg border border-[#1e1e1e] bg-[#141414] px-3 py-2 text-sm text-[#e5e5e5] outline-none focus:border-[#2f81f7] transition-colors"
        />

        {/* Frequency */}
        <select
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as typeof frequency)}
          className="rounded-lg border border-[#1e1e1e] bg-[#141414] px-3 py-2 text-sm text-[#e5e5e5] outline-none focus:border-[#2f81f7] transition-colors"
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>

        {/* Load Data */}
        <button
          onClick={handleLoadData}
          disabled={isFetchingPrices}
          className="flex items-center gap-2 rounded-lg bg-[#2f81f7] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[#4d94f8] disabled:opacity-50"
        >
          {isFetchingPrices ? (
            <>
              <LoadingSpinner size={14} />
              Loading…
            </>
          ) : (
            'Load Data'
          )}
        </button>

        {/* Status badges */}
        {hasData && !isFetchingPrices && (
          <span className="text-xs text-[#555]">
            {nAssets} assets · {nPeriods} periods
          </span>
        )}
        {fetchError && (
          <span className="text-xs text-[#ef4444]">
            {fetchError.message ?? String(fetchError)}
          </span>
        )}
      </motion.div>

      {/* ── BODY ────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── LEFT PANEL ──────────────────────────────────────────────── */}
        <motion.aside
          variants={stagger.item}
          className="flex w-72 shrink-0 flex-col gap-5 overflow-y-auto border-r border-[#1e1e1e] bg-[#0d0d0d] p-4"
        >
          {/* Algorithm selector */}
          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#555]">
              Algorithm
            </h3>
            <div className="space-y-1.5">
              {ALGORITHMS.map(({ id, label }) => (
                <label
                  key={id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-[#141414]"
                >
                  <input
                    type="radio"
                    name="algorithm"
                    value={id}
                    checked={algorithm === id}
                    onChange={() => setAlgorithm(id)}
                    className="accent-[#2f81f7]"
                  />
                  <span className="text-sm text-[#ccc]">{label}</span>
                </label>
              ))}
            </div>
          </section>

          {/* Constraints */}
          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#555]">
              Constraints
            </h3>
            <div className="space-y-4">
              {/* Long only toggle */}
              <label className="flex cursor-pointer items-center justify-between">
                <span className="text-xs text-[#777]">Long only</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={longOnly}
                  onClick={() => store.setConstraints({ longOnly: !longOnly })}
                  className={`relative h-5 w-9 rounded-full transition-colors ${
                    longOnly ? 'bg-[#2f81f7]' : 'bg-[#333]'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                      longOnly ? 'translate-x-[18px]' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </label>

              <SliderField
                label="Lower bound"
                value={lb}
                min={0} max={0.5} step={0.01}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onChange={(v) => store.setConstraints({ lb: v })}
              />

              <SliderField
                label="Upper bound"
                value={ub}
                min={0.1} max={1.0} step={0.01}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onChange={(v) => store.setConstraints({ ub: v })}
              />

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-[#777]">Risk-free rate</span>
                  <span className="font-medium text-[#e5e5e5]">
                    {(rf * 100).toFixed(2)}%
                  </span>
                </div>
                <input
                  type="number"
                  min={0} max={0.2} step={0.001}
                  value={rf}
                  onChange={(e) =>
                    store.setConstraints({ rf: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full rounded-md border border-[#1e1e1e] bg-[#141414] px-2 py-1.5 text-xs text-[#e5e5e5] outline-none focus:border-[#2f81f7]"
                />
              </div>

              <SliderField
                label="Shrinkage α"
                value={shrinkageAlpha}
                min={0} max={1} step={0.05}
                format={(v) => v.toFixed(2)}
                onChange={(v) => store.setConstraints({ shrinkageAlpha: v })}
              />

              {algorithm === 'markowitz' && (
                <SliderField
                  label="Frontier points"
                  value={nPoints}
                  min={10} max={100} step={5}
                  onChange={(v) => store.setConstraints({ nPoints: v })}
                />
              )}
            </div>
          </section>

          {/* Optimize button */}
          <div className="mt-auto">
            <button
              onClick={handleOptimize}
              disabled={!hasData || isOptimizing}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#2f81f7] py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#4d94f8] disabled:opacity-40"
            >
              {isOptimizing ? (
                <>
                  <LoadingSpinner size={14} />
                  Computing…
                </>
              ) : (
                'Optimize'
              )}
            </button>

            {!hasData && (
              <p className="mt-2 text-center text-xs text-[#555]">
                Load data first
              </p>
            )}
          </div>
        </motion.aside>

        {/* ── MAIN AREA ────────────────────────────────────────────────── */}
        <motion.main
          variants={stagger.item}
          className="flex flex-1 flex-col gap-4 overflow-y-auto p-4"
        >
          {/* WASM missing banner */}
          <AnimatePresence>
            {wasmMissing && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="rounded-lg border border-[#f59e0b]/30 bg-[#f59e0b]/10 px-4 py-3 text-sm text-[#f59e0b]"
              >
                <span className="font-semibold">WASM engine not built.</span>{' '}
                Run{' '}
                <code className="rounded bg-[#1a1a1a] px-1.5 py-0.5 font-mono text-xs">
                  pnpm run build:wasm
                </code>{' '}
                or{' '}
                <code className="rounded bg-[#1a1a1a] px-1.5 py-0.5 font-mono text-xs">
                  bash scripts/build-wasm.sh
                </code>{' '}
                from the repo root, then reload.
              </motion.div>
            )}
          </AnimatePresence>

          {/* Optimization error */}
          <AnimatePresence>
            {optError && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="rounded-lg border border-[#ef4444]/30 bg-[#ef4444]/10 px-4 py-3 text-sm text-[#ef4444]"
              >
                <span className="font-semibold">Optimisation failed:</span> {optError}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Efficient Frontier chart */}
          <div className="flex-1 rounded-xl border border-[#1e1e1e] bg-[#141414] p-4 min-h-[360px]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#e5e5e5]">
                Efficient Frontier
              </h2>
              {frontier && (
                <span className="text-xs text-[#555]">
                  {frontier.nPoints} portfolios · click to select
                </span>
              )}
              {!frontier && currentWeights && (
                <span className="text-xs text-[#555]">
                  {ALGORITHMS.find((a) => a.id === algorithm)?.label}
                </span>
              )}
            </div>
            <div className="h-[calc(100%-32px)]">
              <EfficientFrontier
                points={chartPoints}
                bestIdx={frontier ? (frontier.bestIdx ?? undefined) : undefined}
                tickers={storeTickers}
                selectedIdx={selectedIdx}
                onPointClick={handlePointClick}
              />
            </div>
          </div>

          {/* Weights + Metrics row */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Weight allocation */}
            <div className="rounded-xl border border-[#1e1e1e] bg-[#141414] p-4">
              <h2 className="mb-4 text-sm font-semibold text-[#e5e5e5]">
                Weight Allocation
              </h2>
              {displayWeights && storeTickers.length > 0 ? (
                <WeightBar
                  weights={displayWeights}
                  tickers={storeTickers}
                />
              ) : (
                <p className="text-sm text-[#555]">
                  {hasData ? 'Run optimisation to see weights' : 'Load data first'}
                </p>
              )}
            </div>

            {/* Metrics */}
            <div className="rounded-xl border border-[#1e1e1e] bg-[#141414] p-4">
              <h2 className="mb-4 text-sm font-semibold text-[#e5e5e5]">
                Portfolio Metrics
              </h2>
              <div className="flex gap-3">
                <MetricCard
                  label="Ann. Return"
                  value={metrics?.ret ?? null}
                  format={(v) => `${(v * 100).toFixed(2)}%`}
                  color="#22c55e"
                />
                <MetricCard
                  label="Ann. Volatility"
                  value={metrics?.vol ?? null}
                  format={(v) => `${(v * 100).toFixed(2)}%`}
                  color="#e5e5e5"
                />
                <MetricCard
                  label="Sharpe Ratio"
                  value={metrics?.sharpe ?? null}
                  format={(v) => v.toFixed(3)}
                  color="#2f81f7"
                />
              </div>
            </div>
          </div>
        </motion.main>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Micro helpers
// ---------------------------------------------------------------------------

function LoadingSpinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
    >
      <circle
        cx="12" cy="12" r="10"
        stroke="currentColor"
        strokeWidth="3"
        strokeOpacity="0.25"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
