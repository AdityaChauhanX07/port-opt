'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { skipToken } from '@tanstack/react-query';
import { EfficientFrontier, WeightBar } from '@portopt/charts';
import type { FrontierPoint, AssetStat, AlgorithmMarker, HoverMetrics } from '@portopt/charts';
import { Button, Card, Input, Select, Slider, Tabs } from '@portopt/ui';
import { api } from '../../../lib/trpc/client';
import { usePortfolioStore } from '../../../lib/stores/portfolio';
import { useEngine } from '../../../lib/wasm/use-engine';
import { slideUp, stagger } from '../../../lib/motion';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TICKERS = 'AAPL, MSFT, TLT, GLD, IWM, SPY';

function defaultDateRange() {
  const end   = new Date();
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 5);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

const PPY: Record<string, number> = { daily: 252, weekly: 52, monthly: 12 };

const FREQUENCY_OPTIONS = [
  { value: 'daily',   label: 'Daily'   },
  { value: 'weekly',  label: 'Weekly'  },
  { value: 'monthly', label: 'Monthly' },
];

const ALGORITHM_TABS = [
  { value: 'markowitz',   label: 'MVO'    },
  { value: 'hrp',         label: 'HRP'    },
  { value: 'risk_parity', label: 'ERC'    },
  { value: 'cvar',        label: 'CVaR'   },
  { value: 'robust',      label: 'Robust' },
];

const OVERLAY_ALGORITHMS = ['hrp', 'risk_parity', 'cvar', 'robust'] as const;
type OverlayAlgorithm = typeof OVERLAY_ALGORITHMS[number];

const containerVariants = stagger(0.06);

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
// MetricCard — cross-fade on value change (no counting up)
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
  const displayed = value !== null ? format(value) : '—';
  return (
    <div className="flex-1 min-w-0">
      <p className="mb-1 text-[11px] uppercase tracking-[0.06em] text-tertiary">
        {label}
      </p>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={displayed}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className={`mono text-[26px] font-semibold leading-none ${colorClass}`}
        >
          {displayed}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Algorithm = 'markowitz' | 'hrp' | 'risk_parity' | 'cvar' | 'robust';

export default function OptimizePage() {
  // ── Local form state ────────────────────────────────────────────────────
  const defaultRange = useMemo(defaultDateRange, []);
  const [tickerText, setTickerText] = useState(DEFAULT_TICKERS);
  const [startDate,  setStartDate]  = useState(defaultRange.start);
  const [endDate,    setEndDate]    = useState(defaultRange.end);
  const [frequency,  setFrequency]  = useState<'daily' | 'weekly' | 'monthly'>('daily');

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

  const [algorithm,    setAlgorithm]    = useState<Algorithm>('markowitz');
  const [selectedIdx,  setSelectedIdx]  = useState<number | null>(null);
  const [optError,     setOptError]     = useState<string | null>(null);
  const [wasmMissing,  setWasmMissing]  = useState(false);

  // ── Hover state (drives weights + metrics display) ───────────────────────
  const [hoveredIdx,     setHoveredIdx]     = useState<number | null>(null);
  const [hoveredWeights, setHoveredWeights] = useState<Float64Array | null>(null);
  const [hoveredMetrics, setHoveredMetrics] = useState<HoverMetrics | null>(null);

  // ── Algorithm overlay toggles ────────────────────────────────────────────
  const [visibleAlgorithms, setVisibleAlgorithms] = useState<Set<string>>(new Set());
  const runningRef = useRef<Set<string>>(new Set());

  // ── Sync selectedIdx to bestIdx on new frontier ──────────────────────────
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
    setVisibleAlgorithms(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricesData]);

  // ── WASM engine ──────────────────────────────────────────────────────────
  const engine = useEngine();
  const ppy    = PPY[frequency] ?? 252;
  const hasData = nPeriods > 0 && !!returns;
  // Returns have T-1 rows; nPeriods from the store counts price rows (T).
  const nRetPeriods = returns && nAssets > 0 ? Math.floor(returns.length / nAssets) : 0;

  // ── Derived chart points ──────────────────────────────────────────────────
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

  // ── Per-asset scatter stats ───────────────────────────────────────────────
  const assetStats = useMemo<AssetStat[]>(() => {
    if (!returns || nRetPeriods === 0 || storeTickers.length === 0) return [];
    return computeAssetStats(returns, nRetPeriods, nAssets, storeTickers, ppy);
  }, [returns, nPeriods, nAssets, storeTickers, ppy]);

  // ── Algorithm overlay markers ─────────────────────────────────────────────
  const algorithmMarkers = useMemo<AlgorithmMarker[]>(() => {
    return OVERLAY_ALGORITHMS
      .filter((name) => algorithmCache[name])
      .map((name) => {
        const e = algorithmCache[name]!;
        return { algorithm: name as AlgorithmMarker['algorithm'], vol: e.vol, ret: e.ret, sharpe: e.sharpe };
      });
  }, [algorithmCache]);

  // ── Display weights & metrics (hover > locked > bestIdx) ─────────────────
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
    const tickers = tickerText
      .split(',')
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
    if (tickers.length === 0) return;
    store.setLoadingData(true);
    setQueryInput({ tickers, start: startDate, end: endDate, interval: frequency });
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
      if (next.has(name)) {
        next.delete(name);
        setVisibleAlgorithms(next);
        return;
      }
      next.add(name);
      setVisibleAlgorithms(next);

      // Run solver if result not already cached and not already running
      if (algorithmCache[name] || runningRef.current.has(name)) return;
      if (!returns || !hasData) return;
      runningRef.current.add(name);

      try {
        let weights: Float64Array | null = null;
        switch (name as OverlayAlgorithm) {
          case 'hrp': {
            weights = await engine.solveHrp(returns, nRetPeriods, nAssets, storeTickers);
            break;
          }
          case 'risk_parity': {
            const cov = computeCovariance(returns, nRetPeriods, nAssets);
            weights   = await engine.solveRiskParity(cov, nAssets, lb, ub);
            break;
          }
          case 'cvar': {
            weights = await engine.solveCvar(returns, nRetPeriods, nAssets, 0.95, longOnly, lb, ub);
            break;
          }
          case 'robust': {
            weights = await engine.solveRobust(returns, nRetPeriods, nAssets, 1.0, longOnly, lb, ub, ppy);
            break;
          }
        }
        if (weights) {
          const stats = portfolioStats(returns, nRetPeriods, nAssets, weights, rf, ppy);
          store.setCachedAlgorithm(name, { weights, vol: stats.vol, ret: stats.ret, sharpe: stats.sharpe });
        }
      } catch {
        // Silently ignore (WASM not available for cvar/robust in browser)
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
          if (result.bestIdx != null) {
            store.setWeights(result.weights.slice(result.bestIdx * nAssets, (result.bestIdx + 1) * nAssets));
          }
          break;
        }
        case 'hrp': {
          const w = await engine.solveHrp(returns, nRetPeriods, nAssets, storeTickers);
          store.setWeights(w);
          store.setFrontier(null);
          break;
        }
        case 'risk_parity': {
          const cov = computeCovariance(returns, nRetPeriods, nAssets);
          const w   = await engine.solveRiskParity(cov, nAssets, lb, ub);
          store.setWeights(w);
          store.setFrontier(null);
          break;
        }
        case 'cvar': {
          const w = await engine.solveCvar(returns, nRetPeriods, nAssets, 0.95, longOnly, lb, ub);
          store.setWeights(w);
          store.setFrontier(null);
          break;
        }
        case 'robust': {
          const w = await engine.solveRobust(returns, nRetPeriods, nAssets, 1.0, longOnly, lb, ub, ppy);
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

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <motion.div
      className="flex h-full flex-col"
      initial="initial"
      animate="animate"
      variants={containerVariants}
    >
      {/* Controls bar */}
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

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left panel */}
        <motion.aside
          variants={slideUp}
          className="flex w-[240px] shrink-0 flex-col overflow-y-auto hairline-r"
          style={{ background: 'var(--bg)' }}
        >
          <div className="px-0">
            <Tabs
              tabs={ALGORITHM_TABS}
              value={algorithm}
              onValueChange={(v) => setAlgorithm(v as Algorithm)}
            />
          </div>

          <div className="flex flex-col gap-5 p-5 flex-1">
            <SectionLabel>Constraints</SectionLabel>

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

        {/* Main area */}
        <motion.div
          variants={slideUp}
          className="flex flex-1 flex-col gap-6 overflow-y-auto p-8"
        >
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
            <Card padding="md" className="flex flex-col">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[13px] font-medium text-primary">
                  Efficient Frontier
                </span>
                {frontier ? (
                  <span className="mono text-[11px] text-muted">
                    {frontier.nPoints} portfolios
                    {hoveredIdx != null ? ` · pt ${hoveredIdx + 1}` : ' · hover to explore'}
                  </span>
                ) : currentWeights ? (
                  <span className="mono text-[11px] text-muted">
                    {ALGORITHM_TABS.find((a) => a.value === algorithm)?.label}
                  </span>
                ) : null}
              </div>
              <div className="min-h-[320px]">
                <EfficientFrontier
                  points={chartPoints}
                  bestIdx={frontier ? (frontier.bestIdx ?? undefined) : undefined}
                  tickers={storeTickers}
                  rf={rf}
                  assetStats={assetStats.length > 0 ? assetStats : undefined}
                  algorithmMarkers={algorithmMarkers}
                  visibleAlgorithms={visibleAlgorithms}
                  selectedIdx={selectedIdx}
                  onPointHover={handlePointHover}
                  onPointSelect={handlePointSelect}
                  onToggleAlgorithm={hasData ? handleToggleAlgorithm : undefined}
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
                  {hoveredIdx != null && (
                    <span className="ml-2 normal-case text-muted">— hovering</span>
                  )}
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
// Local helpers
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-[0.08em] text-muted">
      {children}
    </p>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
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
