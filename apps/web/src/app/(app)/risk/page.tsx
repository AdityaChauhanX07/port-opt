'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { Button, Card, Input, Slider, Tabs } from '@portopt/ui';
import {
  MonteCarloFan,
  CorrelationMatrix,
  TimeSeriesLine,
  GroupedBarChart,
  RegimeTimeline,
} from '@portopt/charts';
import type { RegimeResult } from '@/lib/wasm/types';
import { usePortfolioStore } from '@/lib/stores/portfolio';
import { useRiskStore } from '@/lib/stores/risk';
import { useEngine } from '@/lib/wasm/use-engine';

// Three.js globe — client-only, no SSR
const CorrelationGlobe = dynamic(
  () => import('@portopt/three').then((m) => m.CorrelationGlobe),
  { ssr: false, loading: () => <div style={{ height: 600 }} className="flex items-center justify-center"><p className="mono text-[13px] text-tertiary">Loading…</p></div> },
);
import { slideUp, stagger } from '@/lib/motion';

// ---------------------------------------------------------------------------
// Token constants (for D3 series colors — CSS vars inaccessible in SVG attrs)
// ---------------------------------------------------------------------------

const C = {
  accent:  '#5e8eff',
  accent2: '#8b5cf6',
  gain:    '#3fb950',
  loss:    '#f85149',
  neutral: '#8b949e',
  warn:    '#f59e0b',
};

const PPY_MAP = { daily: 252, weekly: 52, monthly: 12 } as const;

// ---------------------------------------------------------------------------
// Stress periods
// ---------------------------------------------------------------------------

const STRESS_PERIODS = [
  { name: 'GFC',         start: '2007-10-01', end: '2009-03-31' },
  { name: 'COVID crash', start: '2020-02-01', end: '2020-04-30' },
  { name: '2022 rates',  start: '2022-01-01', end: '2022-12-31' },
];

// ---------------------------------------------------------------------------
// Computation helpers (all pure JS, no WASM)
// ---------------------------------------------------------------------------

function computePortfolioReturns(
  returns: Float64Array,
  nAssets: number,
  weights: Float64Array,
): Float64Array {
  const nRet = Math.floor(returns.length / nAssets);
  const out = new Float64Array(nRet);
  for (let t = 0; t < nRet; t++) {
    let r = 0;
    for (let i = 0; i < nAssets; i++) {
      r += (weights[i] ?? 0) * (returns[t * nAssets + i] ?? 0);
    }
    out[t] = r;
  }
  return out;
}

function computeEquity(portRet: Float64Array): Float64Array {
  const equity = new Float64Array(portRet.length);
  let val = 1.0;
  for (let t = 0; t < portRet.length; t++) {
    val *= 1 + portRet[t];
    equity[t] = val;
  }
  return equity;
}

function computeVarCVar(portRet: Float64Array, alpha: number) {
  if (portRet.length === 0) return null;
  const sorted = Array.from(portRet).sort((a, b) => a - b);
  const n = sorted.length;
  const varIdx = Math.min(Math.floor((1 - alpha) * n), n - 1);
  const varValue = -sorted[varIdx];

  const cvarN = Math.max(1, varIdx);
  const cvarValue = -sorted.slice(0, cvarN).reduce((a, b) => a + b, 0) / cvarN;

  const mean = portRet.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? portRet.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const std = Math.sqrt(variance);
  const m3 = portRet.reduce((a, b) => a + (b - mean) ** 3, 0) / n;
  const skewness = std > 0 ? m3 / std ** 3 : 0;

  return { varValue, cvarValue, mean, skewness };
}

function computeRollingSharpe(
  portRet: Float64Array,
  window: number,
  ppy: number,
): { sharpe: Array<number | null>; sortino: Array<number | null> } {
  const n = portRet.length;
  const sharpe: Array<number | null> = new Array(n).fill(null);
  const sortino: Array<number | null> = new Array(n).fill(null);

  for (let t = window - 1; t < n; t++) {
    const slice: number[] = [];
    for (let k = t - window + 1; k <= t; k++) slice.push(portRet[k]);

    const mu = slice.reduce((a, b) => a + b, 0) / window;
    const variance = slice.reduce((a, b) => a + (b - mu) ** 2, 0) / (window - 1);
    const sigma = Math.sqrt(variance);

    const negRets = slice.filter((r) => r < 0);
    const downVar = negRets.length > 0
      ? negRets.reduce((a, b) => a + b ** 2, 0) / negRets.length
      : 0;
    const downDev = Math.sqrt(downVar * ppy);

    const annMu = mu * ppy;
    sharpe[t] = sigma > 0 ? annMu / (sigma * Math.sqrt(ppy)) : null;
    sortino[t] = downDev > 0 ? annMu / downDev : null;
  }

  return { sharpe, sortino };
}

function computeCovMatrix(returns: Float64Array, nAssets: number): Float64Array {
  const nRet = Math.floor(returns.length / nAssets);
  const means = new Float64Array(nAssets);
  for (let i = 0; i < nAssets; i++) {
    let s = 0;
    for (let t = 0; t < nRet; t++) s += returns[t * nAssets + i];
    means[i] = s / nRet;
  }
  const cov = new Float64Array(nAssets * nAssets);
  for (let i = 0; i < nAssets; i++) {
    for (let j = i; j < nAssets; j++) {
      let s = 0;
      for (let t = 0; t < nRet; t++) {
        s += (returns[t * nAssets + i] - means[i]) * (returns[t * nAssets + j] - means[j]);
      }
      const c = nRet > 1 ? s / (nRet - 1) : 0;
      cov[i * nAssets + j] = c;
      cov[j * nAssets + i] = c;
    }
  }
  return cov;
}

function computeRiskContribution(weights: Float64Array, cov: Float64Array, nAssets: number) {
  const covW = new Float64Array(nAssets);
  for (let i = 0; i < nAssets; i++) {
    for (let j = 0; j < nAssets; j++) {
      covW[i] += cov[i * nAssets + j] * weights[j];
    }
  }
  let sigmaP2 = 0;
  for (let i = 0; i < nAssets; i++) sigmaP2 += weights[i] * covW[i];
  const rcPct = new Float64Array(nAssets);
  for (let i = 0; i < nAssets; i++) {
    rcPct[i] = sigmaP2 > 0 ? (weights[i] * covW[i]) / sigmaP2 : 1 / nAssets;
  }
  return rcPct;
}

function computeStressPeriods(
  periods: typeof STRESS_PERIODS,
  equityDates: string[],
  equitySeries: Array<{ label: string; equity: Float64Array }>,
) {
  const results: Array<{
    name: string; startDate: string; endDate: string;
    series: Array<{ label: string; cumRet: number; maxDD: number; recoveryDays: number | null }>;
  }> = [];

  for (const p of periods) {
    const startIdx = equityDates.findIndex((d) => d >= p.start);
    if (startIdx === -1) continue;
    let endIdx = -1;
    for (let i = equityDates.length - 1; i >= 0; i--) {
      if (equityDates[i] <= p.end) { endIdx = i; break; }
    }
    if (endIdx === -1 || startIdx >= endIdx) continue;

    const series = equitySeries.map(({ label, equity }) => {
      const startVal = equity[startIdx] || 1;
      const endVal   = equity[endIdx]   || 1;
      const cumRet   = endVal / startVal - 1;
      let peak = equity[startIdx];
      let maxDD = 0;
      for (let i = startIdx; i <= endIdx; i++) {
        if (equity[i] > peak) peak = equity[i];
        const dd = peak > 0 ? equity[i] / peak - 1 : 0;
        if (dd < maxDD) maxDD = dd;
      }
      let recoveryDays: number | null = null;
      for (let i = endIdx + 1; i < equity.length; i++) {
        if (equity[i] >= startVal) {
          const a = new Date(equityDates[startIdx] ?? p.start);
          const b = new Date(equityDates[i]        ?? p.end);
          recoveryDays = Math.round((b.getTime() - a.getTime()) / 86_400_000);
          break;
        }
      }
      return { label, cumRet, maxDD, recoveryDays };
    });

    results.push({
      name:      p.name,
      startDate: equityDates[startIdx] ?? p.start,
      endDate:   equityDates[endIdx]   ?? p.end,
      series,
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <p className="shrink-0 text-[11px] font-medium uppercase tracking-[0.06em] text-tertiary">
        {label}
      </p>
      <div className="flex-1 h-px bg-[var(--border)]" />
    </div>
  );
}

function MetricCard({
  label,
  value,
  variant = 'default',
  sub,
}: {
  label: string;
  value: string;
  variant?: 'default' | 'gain' | 'loss' | 'accent' | 'warn';
  sub?: string;
}) {
  const colorCls =
    variant === 'gain'   ? 'text-gain'   :
    variant === 'loss'   ? 'text-loss'   :
    variant === 'accent' ? 'text-accent' :
    variant === 'warn'   ? 'text-warn'   :
    'text-primary';
  return (
    <div className="flex flex-col gap-1 rounded-md bg-subtle px-4 py-3">
      <span className="text-[11px] uppercase tracking-[0.05em] text-tertiary">{label}</span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={value}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className={`mono text-lg font-medium tabular-nums leading-none ${colorCls}`}
        >
          {value}
        </motion.span>
      </AnimatePresence>
      {sub && <span className="text-[11px] text-tertiary">{sub}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function RiskPage() {
  const store          = usePortfolioStore();
  const returns        = store.returns;
  const nPeriods       = store.nPeriods;
  const nAssets        = store.nAssets;
  const tickers        = store.tickers;
  const dates          = store.dates;
  const frequency      = store.frequency;
  const currentWeights = store.currentWeights;

  const {
    mcResult, isMcRunning, mcError,
    corrMatrix, isCorrLoading, corrError,
    setMcResult, setMcRunning, setMcError,
    setCorrMatrix, setCorrLoading, setCorrError,
    reset: resetRisk,
  } = useRiskStore();

  const engine = useEngine();

  // ── UI state ───────────────────────────────────────────────────────────────
  const [confidence,    setConfidence]    = useState(0.95);
  const [horizon,       setHorizon]       = useState(1);
  const [nPaths,        setNPaths]        = useState(1000);
  const [mcSeed,        setMcSeed]        = useState(42);
  const [rollingWindow, setRollingWindow] = useState(126);
  const [rollingHover,  setRollingHover]  = useState<number | null>(null);
  const [corrView,      setCorrView]      = useState<'2d' | '3d'>('2d');

  // Regime detection
  const [regimeResult,    setRegimeResult]    = useState<RegimeResult | null>(null);
  const [isRegimeRunning, setIsRegimeRunning] = useState(false);
  const [regimeError,     setRegimeError]     = useState<string | null>(null);
  const [nRegimes,        setNRegimes]        = useState(2);

  // ── Prerequisites ──────────────────────────────────────────────────────────
  const hasData    = returns !== null && nPeriods > 1 && nAssets > 0;
  const hasWeights = currentWeights !== null;
  const ready      = hasData && hasWeights;

  // Reset risk caches when underlying data changes
  const prevReturnsRef = useRef<Float64Array | null>(null);
  useEffect(() => {
    if (prevReturnsRef.current !== returns) {
      prevReturnsRef.current = returns;
      resetRisk();
    }
  }, [returns, resetRisk]);

  // ── Derived quantities ────────────────────────────────────────────────────

  const ppy = PPY_MAP[frequency];
  // Returns have T-1 rows; nPeriods from the store counts price rows (T).
  const nRetPeriods = returns && nAssets > 0 ? Math.floor(returns.length / nAssets) : 0;

  const portRet = useMemo(() => {
    if (!returns || !currentWeights || nAssets < 1) return null;
    return computePortfolioReturns(returns, nAssets, currentWeights);
  }, [returns, nAssets, currentWeights]);

  const riskStats = useMemo(
    () => portRet ? computeVarCVar(portRet, confidence) : null,
    [portRet, confidence],
  );

  const portEquity = useMemo(
    () => portRet ? computeEquity(portRet) : null,
    [portRet],
  );

  const ewEquity = useMemo(() => {
    if (!returns || nAssets < 1) return null;
    const ewW = new Float64Array(nAssets).fill(1 / nAssets);
    return computeEquity(computePortfolioReturns(returns, nAssets, ewW));
  }, [returns, nAssets]);

  // annualised stats from portfolio returns (used for MC fan chart)
  const annStats = useMemo(() => {
    if (!portRet || portRet.length < 2) return null;
    const n = portRet.length;
    const mean = portRet.reduce((a, b) => a + b, 0) / n;
    const variance = portRet.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
    return {
      muAnnual:  mean * ppy,
      volAnnual: Math.sqrt(variance * ppy),
    };
  }, [portRet, ppy]);

  // Rolling Sharpe / Sortino
  const rollingMetrics = useMemo(() => {
    if (!portRet || portRet.length < rollingWindow + 1) return null;
    return computeRollingSharpe(portRet, rollingWindow, ppy);
  }, [portRet, rollingWindow, ppy]);

  // Covariance matrix + risk contribution
  const { covMatrix, rcPct } = useMemo(() => {
    if (!returns || !currentWeights || nAssets < 1) return {};
    const cov = computeCovMatrix(returns, nAssets);
    const rc  = computeRiskContribution(currentWeights, cov, nAssets);
    return { covMatrix: cov, rcPct: rc };
  }, [returns, nAssets, currentWeights]);

  // Stress periods (aligned with equityDates = dates.slice(1))
  const equityDates = useMemo(() => dates.slice(1), [dates]);

  const stressData = useMemo(() => {
    if (!portEquity || equityDates.length === 0) return [];
    const series: Array<{ label: string; equity: Float64Array }> = [
      { label: 'Portfolio', equity: portEquity },
    ];
    if (ewEquity) series.push({ label: 'Equal Weight', equity: ewEquity });

    const spyIdx = tickers.indexOf('SPY');
    if (spyIdx >= 0 && returns) {
      const nRet = Math.floor(returns.length / nAssets);
      const spyEq = new Float64Array(nRet);
      let val = 1;
      for (let t = 0; t < nRet; t++) {
        val *= 1 + (returns[t * nAssets + spyIdx] ?? 0);
        spyEq[t] = val;
      }
      series.push({ label: 'SPY', equity: spyEq });
    }

    return computeStressPeriods(STRESS_PERIODS, equityDates, series);
  }, [portEquity, ewEquity, equityDates, tickers, returns, nAssets]);

  const stressChartData = useMemo(
    () =>
      stressData.map((sp) => ({
        group: sp.name,
        bars: sp.series.map((s, i) => ({
          label: s.label,
          value: s.cumRet,
          color: i === 0 ? (s.cumRet >= 0 ? C.gain : C.loss) : C.neutral,
        })),
      })),
    [stressData],
  );

  // Sorted risk contributions (descending)
  const sortedRcPct = useMemo(() => {
    if (!rcPct) return [];
    return Array.from({ length: nAssets }, (_, i) => ({
      ticker: tickers[i] ?? `A${i}`,
      rc: rcPct[i] ?? 0,
    })).sort((a, b) => b.rc - a.rc);
  }, [rcPct, nAssets, tickers]);

  // ── Correlation matrix (async WASM) ───────────────────────────────────────

  useEffect(() => {
    if (!returns || !nRetPeriods || !nAssets || corrMatrix) return;
    setCorrLoading(true);
    setCorrError(null);
    engine
      .computeCorrelation(returns, nRetPeriods, nAssets)
      .then((m) => {
        setCorrMatrix(m as Float64Array);
        setCorrLoading(false);
      })
      .catch((e) => {
        setCorrError(e instanceof Error ? e.message : String(e));
        setCorrLoading(false);
      });
  }, [returns, nRetPeriods, nAssets, corrMatrix, engine, setCorrMatrix, setCorrLoading, setCorrError]);

  // ── Monte Carlo ──────────────────────────────────────────────────────────

  const runMonteCarlo = useCallback(async () => {
    if (!annStats) return;
    setMcRunning(true);
    setMcError(null);
    try {
      const result = await engine.runMonteCarlo({
        mu_annual:   annStats.muAnnual,
        vol_annual:  annStats.volAnnual,
        start_value: 1.0,
        years:       horizon,
        ppy,
        n_paths:     nPaths,
        seed:        mcSeed,
      });
      setMcResult(result, {
        horizon,
        nPaths,
        seed: mcSeed,
        muAnnual:  annStats.muAnnual,
        volAnnual: annStats.volAnnual,
        ppy,
      });
    } catch (e) {
      setMcError(e instanceof Error ? e.message : String(e));
    } finally {
      setMcRunning(false);
    }
  }, [annStats, horizon, ppy, nPaths, mcSeed, engine, setMcResult, setMcRunning, setMcError]);

  // ── Regime detection ─────────────────────────────────────────────────────

  const runRegimeDetection = useCallback(async () => {
    if (!portRet) return;
    setIsRegimeRunning(true);
    setRegimeError(null);
    try {
      const result = await engine.detectRegimes(portRet, nRegimes, 100, 42);
      setRegimeResult(result);
    } catch (e) {
      setRegimeError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsRegimeRunning(false);
    }
  }, [portRet, nRegimes, engine]);

  // ── Formatters ─────────────────────────────────────────────────────────────

  const fmtPct = (v: number | null | undefined, decimals = 2) =>
    v == null ? '—' : `${(v * 100).toFixed(decimals)}%`;
  const fmtNum = (v: number | null | undefined, d = 3) =>
    v == null ? '—' : v.toFixed(d);

  // ── Early return: empty state ─────────────────────────────────────────────

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="mb-3 text-[14px] text-tertiary">No portfolio weights computed yet.</p>
          <Link
            href="/optimize"
            className="text-[14px] text-accent hover:text-accent-hover transition-colors duration-[var(--duration)]"
          >
            Compute weights on the Optimize workspace first →
          </Link>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <motion.div
      className="overflow-y-auto p-6 flex flex-col"
      style={{ gap: 'var(--space-12)' }}
      initial="initial"
      animate="animate"
      variants={stagger(0.05)}
    >

      {/* ── SECTION 1: Risk metrics summary ─────────────────────────────── */}
      <motion.section variants={slideUp}>
        <SectionHeader label="Risk Metrics" />

        {/* Controls */}
        <div className="flex items-center gap-4 mb-5">
          <span className="text-[12px] text-secondary shrink-0">Confidence</span>
          <div className="w-48">
            <Slider
              label="Confidence level"
              value={confidence}
              min={0.90}
              max={0.99}
              step={0.01}
              format={(v) => v.toFixed(2)}
              onChange={setConfidence}
            />
          </div>
          <span className="mono text-[14px] text-primary tabular-nums">{confidence.toFixed(2)}</span>
        </div>

        <div className="grid grid-cols-4 gap-3">
          <MetricCard
            label={`VaR ${(confidence * 100).toFixed(0)}% (per period)`}
            value={riskStats ? `−${fmtPct(riskStats.varValue)}` : '—'}
            variant="loss"
          />
          <MetricCard
            label={`CVaR ${(confidence * 100).toFixed(0)}% (per period)`}
            value={riskStats ? `−${fmtPct(riskStats.cvarValue)}` : '—'}
            variant="loss"
          />
          <MetricCard
            label="Mean return (per period)"
            value={riskStats ? `${riskStats.mean >= 0 ? '+' : ''}${fmtPct(riskStats.mean, 3)}` : '—'}
            variant={riskStats ? (riskStats.mean >= 0 ? 'gain' : 'loss') : 'default'}
          />
          <MetricCard
            label="Skewness"
            value={riskStats ? fmtNum(riskStats.skewness) : '—'}
          />
        </div>
      </motion.section>

      {/* ── SECTION 2: Monte Carlo simulation ───────────────────────────── */}
      <motion.section variants={slideUp}>
        <SectionHeader label="Monte Carlo Simulation" />

        {/* Controls */}
        <div className="grid grid-cols-3 gap-6 mb-5">
          <div>
            <p className="text-[11px] uppercase tracking-[0.05em] text-tertiary mb-2">
              Horizon — <span className="mono text-primary normal-case tracking-normal">{horizon}y</span>
            </p>
            <Slider
              label="Horizon"
              value={horizon}
              min={0.25}
              max={5}
              step={0.25}
              format={(v) => `${v}y`}
              onChange={setHorizon}
            />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.05em] text-tertiary mb-2">
              Paths — <span className="mono text-primary normal-case tracking-normal">{nPaths.toLocaleString()}</span>
            </p>
            <Slider
              label="Paths"
              value={nPaths}
              min={100}
              max={10000}
              step={100}
              format={(v) => v.toLocaleString()}
              onChange={setNPaths}
            />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.05em] text-tertiary mb-2">Seed</p>
            <Input
              type="number"
              value={String(mcSeed)}
              onChange={(e) => setMcSeed(Number(e.target.value))}
              min={0}
              className="w-full"
            />
          </div>
        </div>

        <div className="mb-5">
          <Button
            variant="secondary"
            size="md"
            onClick={runMonteCarlo}
            disabled={isMcRunning || !annStats}
            loading={isMcRunning}
          >
            {isMcRunning ? 'Running…' : 'Run Monte Carlo'}
          </Button>
          {mcError && (
            <span className="ml-3 text-[12px] text-loss">{mcError}</span>
          )}
          {annStats && (
            <span className="ml-3 text-[12px] text-tertiary mono">
              μ = {fmtPct(annStats.muAnnual, 1)}/yr · σ = {fmtPct(annStats.volAnnual, 1)}/yr
            </span>
          )}
        </div>

        {/* Fan chart — always visible, uses analytical GBM */}
        {annStats && (
          <Card padding="md" className="mb-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[13px] font-medium text-primary">Equity fan (GBM analytical)</p>
              <div className="flex items-center gap-4 text-[11px] text-tertiary">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-4 h-0.5 rounded" style={{ background: 'rgba(94,142,255,0.14)', border: '1px solid rgba(94,142,255,0.4)' }} />
                  5–95%
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-4 h-0.5 rounded" style={{ background: 'rgba(94,142,255,0.28)', border: '1px solid rgba(94,142,255,0.6)' }} />
                  25–75%
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-4 h-0.5 bg-accent rounded" />
                  median
                </span>
              </div>
            </div>
            <MonteCarloFan
              muAnnual={annStats.muAnnual}
              volAnnual={annStats.volAnnual}
              ppy={ppy}
              years={horizon}
              height={280}
            />
          </Card>
        )}

        {/* Terminal stat cards from WASM run */}
        {mcResult && (
          <div className="grid grid-cols-5 gap-3">
            <MetricCard
              label="Terminal mean"
              value={mcResult.mean != null ? `${mcResult.mean.toFixed(3)}×` : '—'}
            />
            <MetricCard
              label="Terminal median"
              value={mcResult.median != null ? `${mcResult.median.toFixed(3)}×` : '—'}
            />
            <MetricCard
              label="5th percentile"
              value={mcResult.p5 != null ? `${mcResult.p5.toFixed(3)}×` : '—'}
              variant="loss"
            />
            <MetricCard
              label="95th percentile"
              value={mcResult.p95 != null ? `${mcResult.p95.toFixed(3)}×` : '—'}
              variant="gain"
            />
            <MetricCard
              label="Prob. of loss"
              value={mcResult.probLoss != null ? fmtPct(mcResult.probLoss) : '—'}
              variant={
                mcResult.probLoss == null ? 'default' :
                mcResult.probLoss < 0.10 ? 'gain' :
                mcResult.probLoss < 0.30 ? 'warn' :
                'loss'
              }
            />
          </div>
        )}

        {!mcResult && !isMcRunning && (
          <p className="text-[13px] text-tertiary">
            Run simulation to compute terminal statistics ({nPaths.toLocaleString()} paths, {horizon}y horizon).
          </p>
        )}
      </motion.section>

      {/* ── SECTION 3: Correlation matrix ───────────────────────────────── */}
      <motion.section variants={slideUp}>
        {/* Section header + view toggle on the same row */}
        <div className="flex items-center gap-3 mb-5">
          <p className="shrink-0 text-[11px] font-medium uppercase tracking-[0.06em] text-tertiary">
            Correlation Matrix
          </p>
          <div className="flex-1 h-px bg-[var(--border)]" />
          {corrMatrix && (
            <Tabs
              tabs={[
                { value: '2d', label: '2D Heatmap' },
                { value: '3d', label: '3D Globe'   },
              ]}
              value={corrView}
              onValueChange={(v) => setCorrView(v as '2d' | '3d')}
            />
          )}
        </div>

        {isCorrLoading && (
          <p className="text-[13px] text-tertiary">Computing correlation…</p>
        )}
        {corrError && (
          <p className="text-[13px] text-loss">{corrError}</p>
        )}

        {corrMatrix && !isCorrLoading && (
          <AnimatePresence mode="wait" initial={false}>
            {corrView === '2d' ? (
              <motion.div
                key="heatmap"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                <CorrelationMatrix
                  matrix={corrMatrix}
                  tickers={tickers}
                  returns={returns}
                  nAssets={nAssets}
                />
              </motion.div>
            ) : (
              <motion.div
                key="globe"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                <CorrelationGlobe
                  correlations={corrMatrix}
                  tickers={tickers}
                />
              </motion.div>
            )}
          </AnimatePresence>
        )}

        {!corrMatrix && !isCorrLoading && !corrError && (
          <p className="text-[13px] text-tertiary">Correlation matrix will load automatically.</p>
        )}
      </motion.section>

      {/* ── SECTION 4: Rolling Sharpe & Sortino ─────────────────────────── */}
      <motion.section variants={slideUp}>
        <SectionHeader label="Rolling Sharpe & Sortino" />

        <div className="flex items-center gap-4 mb-5">
          <span className="text-[12px] text-secondary shrink-0">Window</span>
          <div className="w-48">
            <Slider
              label="Rolling window"
              value={rollingWindow}
              min={30}
              max={252}
              step={10}
              format={(v) => `${Math.round(v)}d`}
              onChange={(v) => setRollingWindow(Math.round(v))}
            />
          </div>
          <span className="mono text-[14px] text-primary tabular-nums">{rollingWindow}</span>
        </div>

        {rollingMetrics ? (
          <Card padding="md">
            <TimeSeriesLine
              series={[
                { label: 'Sharpe',  values: rollingMetrics.sharpe,  color: C.accent  },
                { label: 'Sortino', values: rollingMetrics.sortino, color: C.accent2, dashed: true },
              ]}
              dates={equityDates}
              refLines={[
                { y: 0, stroke: 'rgba(255,255,255,0.08)', dashArray: '4 4' },
                { y: 1, stroke: '#737373', dashArray: '2 4', label: '1' },
              ]}
              yFormat={(v) => v.toFixed(2)}
              height={240}
              hoverIdx={rollingHover}
              onHover={setRollingHover}
            />
            <div className="flex items-center justify-between mt-2 px-1">
              <div className="flex items-center gap-4 text-[11px]">
                <span className="flex items-center gap-1.5 text-accent">
                  <span className="inline-block w-4 h-0.5 bg-accent rounded" />
                  Sharpe
                </span>
                <span className="flex items-center gap-1.5" style={{ color: C.accent2 }}>
                  <span className="inline-block w-4 h-0.5 rounded" style={{ borderTop: `2px dashed ${C.accent2}` }} />
                  Sortino
                </span>
              </div>
              <p className="mono text-[var(--text-xs)] text-tertiary">
                Rolling window: {rollingWindow} periods ({rollingWindow}d)
              </p>
            </div>
          </Card>
        ) : (
          <p className="text-[13px] text-tertiary">
            Need at least {rollingWindow + 1} return periods for rolling window.
          </p>
        )}
      </motion.section>

      {/* ── SECTION 5: Market regime detection ──────────────────────────── */}
      <motion.section variants={slideUp}>
        <SectionHeader label="Market Regime Detection" />

        {/* Controls */}
        <div className="flex items-center gap-4 mb-5">
          <span className="text-[12px] text-secondary shrink-0">Regimes</span>
          <div className="flex gap-2">
            {[2, 3].map((k) => (
              <button
                key={k}
                onClick={() => setNRegimes(k)}
                className={`h-7 w-8 rounded text-[12px] mono transition-colors duration-[var(--duration)] ${
                  nRegimes === k
                    ? 'bg-accent text-white'
                    : 'bg-subtle text-secondary hover:bg-[var(--bg-hover)]'
                }`}
              >
                {k}
              </button>
            ))}
          </div>
          <Button
            variant="secondary"
            size="md"
            onClick={runRegimeDetection}
            disabled={isRegimeRunning || !portRet}
            loading={isRegimeRunning}
          >
            {isRegimeRunning ? 'Fitting HMM…' : 'Detect Regimes'}
          </Button>
          {regimeError && (
            <span className="text-[12px] text-loss">{regimeError}</span>
          )}
        </div>

        {regimeResult && portRet && portEquity ? (
          <>
            {/* Summary cards */}
            <div
              className="grid gap-3 mb-5"
              style={{ gridTemplateColumns: `repeat(${nRegimes}, minmax(0,1fr))` }}
            >
              {Array.from({ length: nRegimes }, (_, k) => {
                const meanAnn = (regimeResult.regimeMeans[k] ?? 0) * ppy;
                const volAnn  = (regimeResult.regimeVols[k]  ?? 0) * Math.sqrt(ppy);
                const frac    = regimeResult.stationaryDist[k] ?? 0;
                const label   = k === 0 ? 'Bear' : k === nRegimes - 1 ? 'Bull' : 'Neutral';
                const variant = k === 0 ? 'loss' : k === nRegimes - 1 ? 'gain' : 'warn';
                return (
                  <div key={k} className="rounded-md bg-subtle px-4 py-3 space-y-1">
                    <span className="text-[11px] uppercase tracking-[0.05em] text-tertiary">{label}</span>
                    <div className={`mono text-lg font-medium tabular-nums ${variant === 'gain' ? 'text-gain' : variant === 'loss' ? 'text-loss' : 'text-warn'}`}>
                      {meanAnn >= 0 ? '+' : ''}{(meanAnn * 100).toFixed(1)}% / yr
                    </div>
                    <div className="text-[11px] text-secondary">
                      σ = {(volAnn * 100).toFixed(1)}% · {(frac * 100).toFixed(0)}% of time
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Timeline chart */}
            <Card padding="md" className="mb-5">
              <p className="text-[12px] font-medium text-secondary mb-3">
                Regime timeline — equity curve with regime background
              </p>
              <RegimeTimeline
                returns={Array.from(portRet)}
                equity={[1, ...Array.from(portEquity)]}
                stateSequence={regimeResult.stateSequence}
                dates={equityDates}
                nRegimes={nRegimes}
                height={220}
              />
            </Card>

            {/* Transition matrix */}
            <div className="mb-5">
              <p className="text-[11px] uppercase tracking-[0.05em] text-tertiary mb-3">
                Transition Matrix
              </p>
              <div className="inline-block rounded-md bg-subtle overflow-hidden">
                <table className="text-[12px] mono">
                  <thead>
                    <tr>
                      <th className="px-4 py-2 text-tertiary text-left">From ╲ To</th>
                      {Array.from({ length: nRegimes }, (_, k) => (
                        <th key={k} className="px-4 py-2 text-tertiary">
                          {k === 0 ? 'Bear' : k === nRegimes - 1 ? 'Bull' : 'Neutral'}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {regimeResult.transitionMatrix.map((row, i) => (
                      <tr key={i} className="hairline-t">
                        <td className="px-4 py-2 text-secondary">
                          {i === 0 ? 'Bear' : i === nRegimes - 1 ? 'Bull' : 'Neutral'}
                        </td>
                        {row.map((p, j) => (
                          <td
                            key={j}
                            className={`px-4 py-2 text-center tabular-nums ${
                              i === j ? 'text-accent font-medium' : 'text-primary'
                            }`}
                          >
                            {(p * 100).toFixed(1)}%
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Per-regime performance table */}
            <div>
              <p className="text-[11px] uppercase tracking-[0.05em] text-tertiary mb-3">
                Regime-conditional Statistics
              </p>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="hairline-b">
                    {['Regime', 'Periods', 'Ann. Return', 'Ann. Vol', 'Sharpe'].map((h) => (
                      <th
                        key={h}
                        className="pb-2 pr-4 text-left text-[11px] uppercase tracking-[0.05em] text-tertiary last:pr-0"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: nRegimes }, (_, k) => {
                    const indices = regimeResult.stateSequence
                      .map((s, t) => (s === k ? t : -1))
                      .filter((t) => t >= 0);
                    const count = indices.length;
                    const rets  = indices.map((t) => portRet[t] ?? 0);
                    const muP   = count > 0 ? rets.reduce((a, b) => a + b, 0) / count : 0;
                    const varP  = count > 1 ? rets.reduce((a, b) => a + (b - muP) ** 2, 0) / (count - 1) : 0;
                    const muA   = muP * ppy;
                    const volA  = Math.sqrt(varP * ppy);
                    const sharpe = volA > 0 ? muA / volA : 0;
                    const label  = k === 0 ? 'Bear' : k === nRegimes - 1 ? 'Bull' : 'Neutral';
                    return (
                      <tr key={k} className="hairline-b last:border-0 hover:bg-[var(--bg-hover)]">
                        <td className="py-2 pr-4 text-secondary">{label}</td>
                        <td className="py-2 pr-4 mono text-secondary">{count}</td>
                        <td className={`py-2 pr-4 mono ${muA >= 0 ? 'text-gain' : 'text-loss'}`}>
                          {muA >= 0 ? '+' : ''}{(muA * 100).toFixed(2)}%
                        </td>
                        <td className="py-2 pr-4 mono text-secondary">{(volA * 100).toFixed(2)}%</td>
                        <td className={`py-2 mono ${sharpe >= 1 ? 'text-gain' : sharpe >= 0 ? 'text-secondary' : 'text-loss'}`}>
                          {sharpe.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          !isRegimeRunning && (
            <p className="text-[13px] text-tertiary">
              Click "Detect Regimes" to fit a {nRegimes}-state Gaussian HMM to the portfolio return series.
            </p>
          )
        )}
      </motion.section>

      {/* ── SECTION 6: Historical stress periods ────────────────────────── */}
      <motion.section variants={slideUp}>
        <SectionHeader label="Historical Stress Periods" />

        {stressData.length > 0 ? (
          <>
            <GroupedBarChart data={stressChartData} height={220} />

            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="hairline-b">
                    {['Period', 'Series', 'Cum. Return', 'Max DD', 'Recovery'].map((h) => (
                      <th
                        key={h}
                        className="pb-2 pr-4 text-left text-[11px] uppercase tracking-[0.05em] text-tertiary last:pr-0 last:text-right"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stressData.flatMap((sp) =>
                    sp.series.map((s, si) => (
                      <tr
                        key={`${sp.name}-${s.label}`}
                        className="hairline-b last:border-0 hover:bg-[var(--bg-hover)]"
                      >
                        {si === 0 ? (
                          <td className="py-2 pr-4 text-secondary" rowSpan={sp.series.length}>
                            <div className="font-medium">{sp.name}</div>
                            <div className="mono text-[11px] text-tertiary">
                              {sp.startDate} – {sp.endDate}
                            </div>
                          </td>
                        ) : null}
                        <td className="py-2 pr-4 text-secondary">{s.label}</td>
                        <td className={`py-2 pr-4 text-right mono font-medium ${s.cumRet >= 0 ? 'text-gain' : 'text-loss'}`}>
                          {s.cumRet >= 0 ? '+' : ''}{(s.cumRet * 100).toFixed(2)}%
                        </td>
                        <td className="py-2 pr-4 text-right mono text-loss">
                          {(s.maxDD * 100).toFixed(2)}%
                        </td>
                        <td className="py-2 text-right mono text-secondary">
                          {s.recoveryDays != null ? `${s.recoveryDays}d` : 'Not yet'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="text-[13px] text-tertiary">
            No overlap between portfolio data and the defined stress periods (GFC, COVID, 2022).
          </p>
        )}
      </motion.section>

      {/* ── SECTION 7: Marginal risk contribution ───────────────────────── */}
      <motion.section variants={slideUp}>
        <SectionHeader label="Marginal Risk Contribution" />

        {sortedRcPct.length > 0 ? (
          <>
            <div className="space-y-2.5 max-w-xl">
              {sortedRcPct.map(({ ticker, rc }) => {
                const equalRc = 1 / nAssets;
                return (
                  <div key={ticker} className="flex items-center gap-3">
                    <span className="w-14 shrink-0 text-right mono text-[12px] text-secondary">
                      {ticker}
                    </span>
                    <div className="relative flex-1 h-6 rounded-sm overflow-hidden bg-subtle">
                      <motion.div
                        className="absolute inset-y-0 left-0 rounded-sm bg-accent"
                        animate={{ width: `${Math.min(rc * 100, 100)}%` }}
                        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                      />
                      {/* Equal contribution reference line */}
                      <div
                        className="absolute inset-y-0 w-px border-l border-dotted border-[var(--border-strong)]"
                        style={{ left: `${equalRc * 100}%` }}
                      />
                    </div>
                    <span className="w-12 shrink-0 text-right mono text-[12px] text-primary tabular-nums">
                      {(rc * 100).toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 max-w-xl mono text-[var(--text-xs)] text-tertiary leading-relaxed">
              MRC_i = w_i × (Σw)_i / σ_p. Shows how much each asset drives total portfolio volatility. Dotted line = equal contribution ({(100 / nAssets).toFixed(1)}%).
            </p>
          </>
        ) : (
          <p className="text-[13px] text-tertiary">Weights required to compute risk contributions.</p>
        )}
      </motion.section>

      {/* ── SECTION 8: Factor exposure ───────────────────────────────────── */}
      <motion.section variants={slideUp}>
        <SectionHeader label="Factor Exposure" />
        <p className="text-[13px] text-tertiary">
          Coming soon — requires factor return data from the Python service.
        </p>
      </motion.section>

    </motion.div>
  );
}
