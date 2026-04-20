'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { Button, Input, Slider } from '@portopt/ui';
import {
  MonteCarloFan,
  CorrelationMatrix,
  TimeSeriesLine,
  GroupedBarChart,
  RegimeTimeline,
  WaterfallChart,
} from '@portopt/charts';
import type { FactorDecomposition, RegimeResult } from '@/lib/wasm/types';
import { api } from '@/lib/trpc/client';
import { usePortfolioStore } from '@/lib/stores/portfolio';
import { useRiskStore } from '@/lib/stores/risk';
import { useEngine } from '@/lib/wasm/use-engine';

const CorrelationGlobe = dynamic(
  () => import('@portopt/three').then((m) => m.CorrelationGlobe),
  { ssr: false, loading: () => <div style={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Loading…</p></div> },
);

// ---------------------------------------------------------------------------
// Token hex values (for D3 chart series)
// ---------------------------------------------------------------------------

const C = {
  accent:  '#3B82F6',
  accent2: '#8B5CF6',
  positive:'#10B981',
  negative:'#EF4444',
  neutral: '#A1A1A8',
  warning: '#F59E0B',
};

const PPY_MAP = { daily: 252, weekly: 52, monthly: 12 } as const;

const FACTOR_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#22D3EE', '#FB923C', '#A3E635',
];

const STRESS_PERIODS = [
  { name: 'GFC',         start: '2007-10-01', end: '2009-03-31' },
  { name: 'COVID crash', start: '2020-02-01', end: '2020-04-30' },
  { name: '2022 rates',  start: '2022-01-01', end: '2022-12-31' },
];

// ---------------------------------------------------------------------------
// Computation helpers (all unchanged)
// ---------------------------------------------------------------------------

function computePortfolioReturns(returns: Float64Array, nAssets: number, weights: Float64Array): Float64Array {
  const nRet = Math.floor(returns.length / nAssets);
  const out = new Float64Array(nRet);
  for (let t = 0; t < nRet; t++) { let r = 0; for (let i = 0; i < nAssets; i++) r += (weights[i] ?? 0) * (returns[t * nAssets + i] ?? 0); out[t] = r; }
  return out;
}

function computeEquity(portRet: Float64Array): Float64Array {
  const equity = new Float64Array(portRet.length);
  let val = 1.0;
  for (let t = 0; t < portRet.length; t++) { val *= 1 + portRet[t]!; equity[t] = val; }
  return equity;
}

function computeVarCVar(portRet: Float64Array, alpha: number) {
  if (portRet.length === 0) return null;
  const sorted = Array.from(portRet).sort((a, b) => a - b);
  const n = sorted.length;
  const varIdx = Math.min(Math.floor((1 - alpha) * n), n - 1);
  const varValue = -(sorted[varIdx] ?? 0);
  const cvarN = Math.max(1, varIdx);
  const cvarValue = -(sorted.slice(0, cvarN).reduce((a, b) => a + b, 0) / cvarN);
  const mean = portRet.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? portRet.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const std = Math.sqrt(variance);
  const m3 = portRet.reduce((a, b) => a + (b - mean) ** 3, 0) / n;
  const skewness = std > 0 ? m3 / std ** 3 : 0;
  return { varValue, cvarValue, mean, skewness };
}

function computeRollingSharpe(portRet: Float64Array, window: number, ppy: number) {
  const n = portRet.length;
  const sharpe: Array<number | null> = new Array(n).fill(null);
  const sortino: Array<number | null> = new Array(n).fill(null);
  for (let t = window - 1; t < n; t++) {
    const slice: number[] = [];
    for (let k = t - window + 1; k <= t; k++) slice.push(portRet[k]!);
    const mu = slice.reduce((a, b) => a + b, 0) / window;
    const variance = slice.reduce((a, b) => a + (b - mu) ** 2, 0) / (window - 1);
    const sigma = Math.sqrt(variance);
    const negRets = slice.filter((r) => r < 0);
    const downDev = Math.sqrt((negRets.length > 0 ? negRets.reduce((a, b) => a + b ** 2, 0) / negRets.length : 0) * ppy);
    const annMu = mu * ppy;
    sharpe[t]  = sigma > 0 ? annMu / (sigma * Math.sqrt(ppy)) : null;
    sortino[t] = downDev > 0 ? annMu / downDev : null;
  }
  return { sharpe, sortino };
}

function computeCovMatrix(returns: Float64Array, nAssets: number): Float64Array {
  const nRet = Math.floor(returns.length / nAssets);
  const means = new Float64Array(nAssets);
  for (let i = 0; i < nAssets; i++) { let s = 0; for (let t = 0; t < nRet; t++) s += returns[t * nAssets + i]!; means[i] = s / nRet; }
  const cov = new Float64Array(nAssets * nAssets);
  for (let i = 0; i < nAssets; i++) {
    for (let j = i; j < nAssets; j++) {
      let s = 0;
      for (let t = 0; t < nRet; t++) s += (returns[t * nAssets + i]! - means[i]!) * (returns[t * nAssets + j]! - means[j]!);
      cov[i * nAssets + j] = cov[j * nAssets + i] = nRet > 1 ? s / (nRet - 1) : 0;
    }
  }
  return cov;
}

function computeRiskContribution(weights: Float64Array, cov: Float64Array, nAssets: number) {
  const covW = new Float64Array(nAssets);
  for (let i = 0; i < nAssets; i++) for (let j = 0; j < nAssets; j++) covW[i] += cov[i * nAssets + j]! * weights[j]!;
  let sigmaP2 = 0;
  for (let i = 0; i < nAssets; i++) sigmaP2 += weights[i]! * covW[i]!;
  const rcPct = new Float64Array(nAssets);
  for (let i = 0; i < nAssets; i++) rcPct[i] = sigmaP2 > 0 ? (weights[i]! * covW[i]!) / sigmaP2 : 1 / nAssets;
  return rcPct;
}

function computeStressPeriods(
  periods: typeof STRESS_PERIODS,
  equityDates: string[],
  equitySeries: Array<{ label: string; equity: Float64Array }>,
) {
  const results: Array<{ name: string; startDate: string; endDate: string; series: Array<{ label: string; cumRet: number; maxDD: number; recoveryDays: number | null }> }> = [];
  for (const p of periods) {
    const startIdx = equityDates.findIndex((d) => d >= p.start);
    if (startIdx === -1) continue;
    let endIdx = -1;
    for (let i = equityDates.length - 1; i >= 0; i--) { if (equityDates[i]! <= p.end) { endIdx = i; break; } }
    if (endIdx === -1 || startIdx >= endIdx) continue;
    const series = equitySeries.map(({ label, equity }) => {
      const startVal = equity[startIdx] || 1;
      const cumRet   = (equity[endIdx] || 1) / startVal - 1;
      let peak = equity[startIdx]!; let maxDD = 0;
      for (let i = startIdx; i <= endIdx; i++) { if (equity[i]! > peak) peak = equity[i]!; const dd = peak > 0 ? equity[i]! / peak - 1 : 0; if (dd < maxDD) maxDD = dd; }
      let recoveryDays: number | null = null;
      for (let i = endIdx + 1; i < equity.length; i++) { if (equity[i]! >= startVal) { recoveryDays = Math.round((new Date(equityDates[i] ?? p.end).getTime() - new Date(equityDates[startIdx] ?? p.start).getTime()) / 86_400_000); break; } }
      return { label, cumRet, maxDD, recoveryDays };
    });
    results.push({ name: p.name, startDate: equityDates[startIdx] ?? p.start, endDate: equityDates[endIdx] ?? p.end, series });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

function PanelSection({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 hover:bg-[var(--surface)] transition-colors duration-[var(--duration-micro)]">
        <span className="text-h3" style={{ color: 'var(--text-tertiary)' }}>{title}</span>
        <ChevronDown size={12} strokeWidth={2} style={{ color: 'var(--text-tertiary)', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--duration-micro) var(--ease)' }} />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function SegCtrl({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex h-7 rounded border border-[var(--border)] overflow-hidden">
      {options.map((opt, i) => (
        <button key={opt.value} type="button" onClick={() => onChange(opt.value)}
          className={['flex-1 text-[12px] font-medium transition-colors duration-[var(--duration-micro)]', i > 0 ? 'border-l border-[var(--border)]' : '',
            value === opt.value ? 'bg-[var(--surface-elevated)] text-primary' : 'text-secondary hover:text-primary'].join(' ')}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function PerfMetric({ label, value, color }: { label: string; value: string; color?: 'positive' | 'negative' | 'accent' | 'warning' }) {
  const vc = color === 'positive' ? 'var(--positive)' : color === 'negative' ? 'var(--negative)' : color === 'accent' ? 'var(--accent)' : color === 'warning' ? 'var(--warning)' : 'var(--text-primary)';
  return (
    <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-md)', padding: '10px 14px' }}>
      <p style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, marginBottom: 4 }}>{label}</p>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 500, color: vc, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{value}</p>
    </div>
  );
}

function RightSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 24 }}>
      <p className="text-h3" style={{ color: 'var(--text-tertiary)', marginBottom: 16 }}>{title}</p>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
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

  const { mcResult, isMcRunning, mcError, corrMatrix, isCorrLoading, corrError, setMcResult, setMcRunning, setMcError, setCorrMatrix, setCorrLoading, setCorrError, reset: resetRisk } = useRiskStore();
  const trpcUtils = api.useUtils();
  const engine = useEngine();

  // ── UI state ───────────────────────────────────────────────────────────────
  const [confidence,    setConfidence]    = useState(0.95);
  const [horizon,       setHorizon]       = useState(1);
  const [nPaths,        setNPaths]        = useState(1000);
  const [mcSeed,        setMcSeed]        = useState(42);
  const [rollingWindow, setRollingWindow] = useState(126);
  const [rollingHover,  setRollingHover]  = useState<number | null>(null);
  const [corrView,      setCorrView]      = useState<'2d' | '3d'>('2d');
  const [regimeResult,    setRegimeResult]    = useState<RegimeResult | null>(null);
  const [isRegimeRunning, setIsRegimeRunning] = useState(false);
  const [regimeError,     setRegimeError]     = useState<string | null>(null);
  const [nRegimes,        setNRegimes]        = useState(2);
  const [factorResult,    setFactorResult]    = useState<FactorDecomposition | null>(null);
  const [isFactorRunning, setIsFactorRunning] = useState(false);
  const [factorError,     setFactorError]     = useState<string | null>(null);
  const [factorModel,     setFactorModel]     = useState<'proxy' | 'ff5'>('proxy');

  const hasData    = returns !== null && nPeriods > 1 && nAssets > 0;
  const hasWeights = currentWeights !== null;
  const ready      = hasData && hasWeights;

  const prevReturnsRef = useRef<Float64Array | null>(null);
  useEffect(() => {
    if (prevReturnsRef.current !== returns) { prevReturnsRef.current = returns; resetRisk(); }
  }, [returns, resetRisk]);

  // ── Derived quantities ────────────────────────────────────────────────────
  const ppy = PPY_MAP[frequency];
  const nRetPeriods = returns && nAssets > 0 ? Math.floor(returns.length / nAssets) : 0;

  const portRet = useMemo(() => { if (!returns || !currentWeights || nAssets < 1) return null; return computePortfolioReturns(returns, nAssets, currentWeights); }, [returns, nAssets, currentWeights]);
  const riskStats = useMemo(() => portRet ? computeVarCVar(portRet, confidence) : null, [portRet, confidence]);
  const portEquity = useMemo(() => portRet ? computeEquity(portRet) : null, [portRet]);
  const ewEquity = useMemo(() => { if (!returns || nAssets < 1) return null; const ewW = new Float64Array(nAssets).fill(1 / nAssets); return computeEquity(computePortfolioReturns(returns, nAssets, ewW)); }, [returns, nAssets]);
  const annStats = useMemo(() => { if (!portRet || portRet.length < 2) return null; const n = portRet.length; const mean = portRet.reduce((a, b) => a + b, 0) / n; const variance = portRet.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1); return { muAnnual: mean * ppy, volAnnual: Math.sqrt(variance * ppy) }; }, [portRet, ppy]);
  const rollingMetrics = useMemo(() => { if (!portRet || portRet.length < rollingWindow + 1) return null; return computeRollingSharpe(portRet, rollingWindow, ppy); }, [portRet, rollingWindow, ppy]);
  const { rcPct } = useMemo(() => { if (!returns || !currentWeights || nAssets < 1) return {}; const cov = computeCovMatrix(returns, nAssets); return { rcPct: computeRiskContribution(currentWeights, cov, nAssets) }; }, [returns, nAssets, currentWeights]);
  const equityDates = useMemo(() => dates.slice(1), [dates]);
  const stressData = useMemo(() => {
    if (!portEquity || equityDates.length === 0) return [];
    const series: Array<{ label: string; equity: Float64Array }> = [{ label: 'Portfolio', equity: portEquity }];
    if (ewEquity) series.push({ label: 'Equal Weight', equity: ewEquity });
    const spyIdx = tickers.indexOf('SPY');
    if (spyIdx >= 0 && returns) { const nRet = Math.floor(returns.length / nAssets); const spyEq = new Float64Array(nRet); let val = 1; for (let t = 0; t < nRet; t++) { val *= 1 + (returns[t * nAssets + spyIdx] ?? 0); spyEq[t] = val; } series.push({ label: 'SPY', equity: spyEq }); }
    return computeStressPeriods(STRESS_PERIODS, equityDates, series);
  }, [portEquity, ewEquity, equityDates, tickers, returns, nAssets]);
  const stressChartData = useMemo(() => stressData.map((sp) => ({ group: sp.name, bars: sp.series.map((s, i) => ({ label: s.label, value: s.cumRet, color: i === 0 ? (s.cumRet >= 0 ? C.positive : C.negative) : C.neutral })) })), [stressData]);
  const sortedRcPct = useMemo(() => { if (!rcPct) return []; return Array.from({ length: nAssets }, (_, i) => ({ ticker: tickers[i] ?? `A${i}`, rc: rcPct[i] ?? 0 })).sort((a, b) => b.rc - a.rc); }, [rcPct, nAssets, tickers]);

  // ── Correlation matrix (auto) ─────────────────────────────────────────────
  useEffect(() => {
    if (!returns || !nRetPeriods || !nAssets || corrMatrix) return;
    setCorrLoading(true); setCorrError(null);
    engine.computeCorrelation(returns, nRetPeriods, nAssets)
      .then((m) => { setCorrMatrix(m as Float64Array); setCorrLoading(false); })
      .catch((e) => { setCorrError(e instanceof Error ? e.message : String(e)); setCorrLoading(false); });
  }, [returns, nRetPeriods, nAssets, corrMatrix, engine, setCorrMatrix, setCorrLoading, setCorrError]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const runMonteCarlo = useCallback(async () => {
    if (!annStats) return;
    setMcRunning(true); setMcError(null);
    try { const result = await engine.runMonteCarlo({ mu_annual: annStats.muAnnual, vol_annual: annStats.volAnnual, start_value: 1.0, years: horizon, ppy, n_paths: nPaths, seed: mcSeed }); setMcResult(result, { horizon, nPaths, seed: mcSeed, muAnnual: annStats.muAnnual, volAnnual: annStats.volAnnual, ppy }); }
    catch (e) { setMcError(e instanceof Error ? e.message : String(e)); }
    finally { setMcRunning(false); }
  }, [annStats, horizon, ppy, nPaths, mcSeed, engine, setMcResult, setMcRunning, setMcError]);

  const runRegimeDetection = useCallback(async () => {
    if (!portRet) return;
    setIsRegimeRunning(true); setRegimeError(null);
    try { setRegimeResult(await engine.detectRegimes(portRet, nRegimes, 100, 42)); }
    catch (e) { setRegimeError(e instanceof Error ? e.message : String(e)); }
    finally { setIsRegimeRunning(false); }
  }, [portRet, nRegimes, engine]);

  const runFactorDecomposition = useCallback(async () => {
    if (!portRet || !store.dateRange) return;
    setIsFactorRunning(true); setFactorError(null);
    try {
      const factorData = await trpcUtils.data.fetchFactors.fetch({ start_date: store.dateRange.start, end_date: store.dateRange.end, frequency: frequency === 'weekly' ? 'daily' : frequency, model: factorModel });
      const { dates: factorDates, factor_names, values } = factorData;
      const K = factor_names.length;
      const portDates = equityDates;
      const portDateSet = new Set(portDates);
      const aligned: number[] = []; const usedPortIdx: number[] = [];
      for (let i = 0; i < factorDates.length; i++) { const d = factorDates[i]; if (portDateSet.has(d)) { const pidx = portDates.indexOf(d); usedPortIdx.push(pidx); for (let k = 0; k < K; k++) aligned.push(values[i * K + k]!); } }
      if (usedPortIdx.length < K + 5) throw new Error('Too few overlapping dates between portfolio and factor data.');
      const result = await engine.decomposeFactorRisk(new Float64Array(usedPortIdx.map((i) => portRet[i] ?? 0)), new Float64Array(aligned), usedPortIdx.length, K, factor_names, ppy);
      setFactorResult(result);
    } catch (e) { setFactorError(e instanceof Error ? e.message : String(e)); }
    finally { setIsFactorRunning(false); }
  }, [portRet, store.dateRange, frequency, factorModel, equityDates, engine, ppy, trpcUtils]);

  // ── Formatters ────────────────────────────────────────────────────────────
  const fmtPct = (v: number | null | undefined, decimals = 2) => v == null ? '—' : `${(v * 100).toFixed(decimals)}%`;
  const fmtNum = (v: number | null | undefined, d = 3) => v == null ? '—' : v.toFixed(d);

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!ready) {
    return (
      <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ marginBottom: 12, fontSize: 14, color: 'var(--text-tertiary)' }}>No portfolio weights computed yet.</p>
          <Link href="/optimize" style={{ fontSize: 14, color: 'var(--accent)', textDecoration: 'none' }}>Compute weights on the Optimize workspace first →</Link>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ height: 'calc(100vh - 88px)', display: 'flex', overflow: 'hidden' }}>

      {/* ══ LEFT PANEL ══════════════════════════════════════════════════════ */}
      <aside data-animate style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--border-subtle)', '--stagger': 1, '--delay': '100ms' } as React.CSSProperties}>
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

          {/* Confidence */}
          <PanelSection title="Confidence">
            <Slider label="Confidence level" value={confidence} min={0.90} max={0.99} step={0.01} format={(v) => `${(v * 100).toFixed(0)}%`} onChange={setConfidence} />
          </PanelSection>

          {/* Monte Carlo */}
          <PanelSection title="Monte Carlo">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Slider label="Horizon" value={horizon} min={0.25} max={5} step={0.25} format={(v) => `${v}y`} onChange={setHorizon} />
              <Slider label="Paths" value={nPaths} min={100} max={10000} step={100} format={(v) => v.toLocaleString()} onChange={setNPaths} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Seed</span>
                <Input type="number" value={String(mcSeed)} onChange={(e) => setMcSeed(Number(e.target.value))} className="w-20 h-7 text-[12px]" />
              </div>
              <Button variant="secondary" size="md" className="w-full" onClick={runMonteCarlo} disabled={isMcRunning || !annStats} loading={isMcRunning}>
                {isMcRunning ? 'Running…' : 'Run Monte Carlo'}
              </Button>
              {mcError && <p style={{ fontSize: 12, color: 'var(--negative)' }}>{mcError}</p>}
            </div>
          </PanelSection>

          {/* Rolling Window */}
          <PanelSection title="Rolling Window">
            <Slider label="Window" value={rollingWindow} min={30} max={252} step={10} format={(v) => `${Math.round(v)}d`} onChange={(v) => setRollingWindow(Math.round(v))} />
          </PanelSection>

          {/* Regime Detection */}
          <PanelSection title="Regime Detection">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <SegCtrl options={[{ value: '2', label: '2-state' }, { value: '3', label: '3-state' }]} value={String(nRegimes)} onChange={(v) => setNRegimes(Number(v))} />
              <Button variant="secondary" size="md" className="w-full" onClick={runRegimeDetection} disabled={isRegimeRunning || !portRet} loading={isRegimeRunning}>
                {isRegimeRunning ? 'Fitting HMM…' : 'Detect Regimes'}
              </Button>
              {regimeError && <p style={{ fontSize: 12, color: 'var(--negative)' }}>{regimeError}</p>}
            </div>
          </PanelSection>

          {/* Factor Model */}
          <PanelSection title="Factor Model" defaultOpen={false}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <SegCtrl options={[{ value: 'proxy', label: 'Market + Sectors' }, { value: 'ff5', label: 'Fama-French 5' }]} value={factorModel} onChange={(v) => setFactorModel(v as 'proxy' | 'ff5')} />
              <Button variant="secondary" size="md" className="w-full" onClick={runFactorDecomposition} disabled={isFactorRunning || !portRet} loading={isFactorRunning}>
                {isFactorRunning ? 'Running OLS…' : 'Run Decomposition'}
              </Button>
            </div>
          </PanelSection>

        </div>
      </aside>

      {/* ══ RIGHT PANEL ═════════════════════════════════════════════════════ */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', paddingBottom: 32 }}>
        <div className="slide-enter-content" style={{ display: 'flex', flexDirection: 'column', gap: 24, '--delay': '100ms' } as React.CSSProperties}>

          {/* 1 — Risk Metrics */}
          <RightSection title="Risk Metrics">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <PerfMetric label={`VaR ${(confidence * 100).toFixed(0)}%`}  value={riskStats ? `−${fmtPct(riskStats.varValue)}` : '—'} color="negative" />
              <PerfMetric label={`CVaR ${(confidence * 100).toFixed(0)}%`} value={riskStats ? `−${fmtPct(riskStats.cvarValue)}` : '—'} color="negative" />
              <PerfMetric label="Mean Return" value={riskStats ? `${riskStats.mean >= 0 ? '+' : ''}${fmtPct(riskStats.mean, 3)}` : '—'} color={riskStats ? (riskStats.mean >= 0 ? 'positive' : 'negative') : undefined} />
              <PerfMetric label="Skewness" value={riskStats ? fmtNum(riskStats.skewness) : '—'} />
            </div>
          </RightSection>

          {/* 2 — Monte Carlo Fan */}
          {annStats && (
            <RightSection title="Monte Carlo Simulation">
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 12 }}>
                μ = {fmtPct(annStats.muAnnual, 1)}/yr · σ = {fmtPct(annStats.volAnnual, 1)}/yr · {horizon}y horizon · {nPaths.toLocaleString()} paths
              </p>
              <MonteCarloFan muAnnual={annStats.muAnnual} volAnnual={annStats.volAnnual} ppy={ppy} years={horizon} height={400} />
              {mcResult && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginTop: 20 }}>
                  <PerfMetric label="Terminal mean"   value={mcResult.mean != null ? `${mcResult.mean.toFixed(3)}×` : '—'} />
                  <PerfMetric label="Median"          value={mcResult.median != null ? `${mcResult.median.toFixed(3)}×` : '—'} />
                  <PerfMetric label="5th pct"         value={mcResult.p5 != null ? `${mcResult.p5.toFixed(3)}×` : '—'} color="negative" />
                  <PerfMetric label="95th pct"        value={mcResult.p95 != null ? `${mcResult.p95.toFixed(3)}×` : '—'} color="positive" />
                  <PerfMetric label="Prob. loss"      value={mcResult.probLoss != null ? fmtPct(mcResult.probLoss) : '—'} color={mcResult.probLoss == null ? undefined : mcResult.probLoss < 0.10 ? 'positive' : mcResult.probLoss < 0.30 ? 'warning' : 'negative'} />
                </div>
              )}
              {!mcResult && !isMcRunning && <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 16 }}>Run Monte Carlo to compute terminal statistics.</p>}
            </RightSection>
          )}

          {/* 3 — Correlation Matrix */}
          <RightSection title="Correlation Matrix">
            {/* 2D/3D toggle */}
            {corrMatrix && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                <SegCtrl options={[{ value: '2d', label: '2D Heatmap' }, { value: '3d', label: '3D Globe' }]} value={corrView} onChange={(v) => setCorrView(v as '2d' | '3d')} />
              </div>
            )}
            {isCorrLoading && <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Computing correlation…</p>}
            {corrError && <p style={{ fontSize: 13, color: 'var(--negative)' }}>{corrError}</p>}
            {corrMatrix && !isCorrLoading && (
              corrView === '2d' ? (
                <CorrelationMatrix matrix={corrMatrix} tickers={tickers} returns={returns} nAssets={nAssets} />
              ) : (
                <CorrelationGlobe correlations={corrMatrix} tickers={tickers} />
              )
            )}
            {!corrMatrix && !isCorrLoading && !corrError && <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Correlation matrix loading…</p>}
          </RightSection>

          {/* 4 — Rolling Sharpe & Sortino */}
          <RightSection title="Rolling Sharpe & Sortino">
            {rollingMetrics ? (
              <>
                <TimeSeriesLine
                  series={[
                    { label: 'Sharpe',  values: rollingMetrics.sharpe,  color: C.accent },
                    { label: 'Sortino', values: rollingMetrics.sortino, color: C.accent2, dashed: true },
                  ]}
                  dates={equityDates}
                  refLines={[
                    { y: 0, stroke: '#2A2A2F', dashArray: '4 4' },
                    { y: 1, stroke: '#737373', dashArray: '2 4', label: '1' },
                  ]}
                  yFormat={(v) => v.toFixed(2)}
                  height={240}
                  hoverIdx={rollingHover}
                  onHover={setRollingHover}
                />
                <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.accent }}>
                    <span style={{ display: 'inline-block', width: 16, height: 2, background: C.accent, borderRadius: 2 }} />Sharpe
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.accent2 }}>
                    <span style={{ display: 'inline-block', width: 16, height: 0, borderTop: `2px dashed ${C.accent2}` }} />Sortino
                  </span>
                  <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>
                    Window: {rollingWindow}d
                  </span>
                </div>
              </>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Need at least {rollingWindow + 1} return periods.</p>
            )}
          </RightSection>

          {/* 5 — Regime Detection results */}
          {(regimeResult || isRegimeRunning) && (
            <RightSection title="Market Regime Detection">
              {isRegimeRunning && <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Fitting HMM…</p>}
              {regimeResult && portRet && portEquity && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${nRegimes}, 1fr)`, gap: 12, marginBottom: 20 }}>
                    {Array.from({ length: nRegimes }, (_, k) => {
                      const meanAnn = (regimeResult.regimeMeans[k] ?? 0) * ppy;
                      const volAnn  = (regimeResult.regimeVols[k]  ?? 0) * Math.sqrt(ppy);
                      const label   = k === 0 ? 'Bear' : k === nRegimes - 1 ? 'Bull' : 'Neutral';
                      return (
                        <div key={k} style={{ background: 'var(--bg-inset)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
                          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, marginBottom: 4 }}>{label}</p>
                          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 500, color: k === 0 ? 'var(--negative)' : k === nRegimes - 1 ? 'var(--positive)' : 'var(--warning)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                            {meanAnn >= 0 ? '+' : ''}{(meanAnn * 100).toFixed(1)}%/yr
                          </p>
                          <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>σ = {(volAnn * 100).toFixed(1)}% · {((regimeResult.stationaryDist[k] ?? 0) * 100).toFixed(0)}% of time</p>
                        </div>
                      );
                    })}
                  </div>
                  <RegimeTimeline
                    returns={Array.from(portRet)}
                    equity={[1, ...Array.from(portEquity)]}
                    stateSequence={regimeResult.stateSequence}
                    dates={equityDates}
                    nRegimes={nRegimes}
                    height={220}
                  />
                </>
              )}
            </RightSection>
          )}

          {/* 6 — Historical Stress Periods */}
          {stressData.length > 0 && (
            <RightSection title="Historical Stress Periods">
              <GroupedBarChart data={stressChartData} height={220} />
              <div style={{ marginTop: 20, overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      {['Period', 'Series', 'Cum. Return', 'Max DD', 'Recovery'].map((h) => (
                        <th key={h} style={{ paddingBottom: 8, paddingRight: 12, textAlign: h === 'Cum. Return' || h === 'Max DD' || h === 'Recovery' ? 'right' : 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', fontWeight: 500 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stressData.flatMap((sp) => sp.series.map((s, si) => (
                      <tr key={`${sp.name}-${s.label}`} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        {si === 0 ? (
                          <td style={{ padding: '6px 12px 6px 0', color: 'var(--text-secondary)' }} rowSpan={sp.series.length}>
                            <div style={{ fontWeight: 500 }}>{sp.name}</div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>{sp.startDate} – {sp.endDate}</div>
                          </td>
                        ) : null}
                        <td style={{ padding: '6px 12px 6px 0', color: 'var(--text-secondary)' }}>{s.label}</td>
                        <td style={{ padding: '6px 12px 6px 0', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 500, color: s.cumRet >= 0 ? 'var(--positive)' : 'var(--negative)', fontVariantNumeric: 'tabular-nums' }}>{s.cumRet >= 0 ? '+' : ''}{(s.cumRet * 100).toFixed(2)}%</td>
                        <td style={{ padding: '6px 12px 6px 0', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--negative)', fontVariantNumeric: 'tabular-nums' }}>{(s.maxDD * 100).toFixed(2)}%</td>
                        <td style={{ padding: '6px 0 6px 0', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{s.recoveryDays != null ? `${s.recoveryDays}d` : 'Not yet'}</td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              </div>
            </RightSection>
          )}

          {/* 7 — Marginal Risk Contribution */}
          {sortedRcPct.length > 0 && (
            <RightSection title="Marginal Risk Contribution">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 520 }}>
                {sortedRcPct.map(({ ticker, rc }) => (
                  <div key={ticker} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 48, flexShrink: 0, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>{ticker}</span>
                    <div style={{ flex: 1, height: 20, background: 'var(--bg-inset)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', position: 'relative' }}>
                      <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${Math.min(rc * 100, 100)}%`, background: 'var(--accent)', borderRadius: 'var(--radius-sm)', transition: 'width var(--duration-micro) var(--ease)' }} />
                      <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(1 / nAssets) * 100}%`, width: 1, background: 'var(--border-strong)' }} />
                    </div>
                    <span style={{ width: 44, flexShrink: 0, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{(rc * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
              <p style={{ marginTop: 10, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>
                MRC_i = w_i × (Σw)_i / σ_p · dotted line = equal contribution ({(100 / nAssets).toFixed(1)}%)
              </p>
            </RightSection>
          )}

          {/* 8 — Factor Decomposition */}
          {(factorResult || factorError || isFactorRunning) && (
            <RightSection title="Factor Decomposition">
              {isFactorRunning && <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Running OLS regression…</p>}
              {factorError && (
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '10px 14px' }}>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Factor data unavailable.</span>{' '}
                    {factorError.length < 120 ? factorError : 'The factor returns endpoint could not be reached or returned an error.'}
                  </p>
                  <button onClick={() => setFactorError(null)} style={{ flexShrink: 0, fontSize: 11, color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer' }}>Dismiss</button>
                </div>
              )}
              {factorResult && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
                    <PerfMetric label="R²" value={factorResult.r_squared.toFixed(3)} color={factorResult.r_squared > 0.7 ? 'positive' : factorResult.r_squared > 0.4 ? 'warning' : undefined} />
                    <PerfMetric label="Alpha (ann.)" value={`${factorResult.alpha >= 0 ? '+' : ''}${(factorResult.alpha * 100).toFixed(2)}%`} color={factorResult.alpha >= 0 ? 'positive' : 'negative'} />
                    <PerfMetric label="Tracking Error" value={`${(factorResult.trackingError * 100).toFixed(2)}%`} />
                    <PerfMetric label="Info. Ratio" value={factorResult.informationRatio.toFixed(2)} color={factorResult.informationRatio > 0.5 ? 'positive' : factorResult.informationRatio > 0 ? 'warning' : 'negative'} />
                  </div>
                  <WaterfallChart showTotal bars={[...factorResult.factorNames.map((name, k) => ({ label: name, value: factorResult.factorRiskContributions[k] ?? 0, color: FACTOR_COLORS[k % FACTOR_COLORS.length]! })), { label: 'Specific', value: factorResult.specificRiskPct, color: '#484848' }]} height={220} />
                  <div style={{ marginTop: 20, overflowX: 'auto' }}>
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          {['Factor', 'Beta', 'Risk Contrib.', 't-stat', 'Sig.'].map((h) => (
                            <th key={h} style={{ paddingBottom: 8, paddingRight: 12, textAlign: h === 'Beta' || h === 'Risk Contrib.' || h === 't-stat' || h === 'Sig.' ? 'right' : 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', fontWeight: 500 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {factorResult.factorNames.map((name, k) => {
                          const beta  = factorResult.betas[k] ?? 0;
                          const rc    = factorResult.factorRiskContributions[k] ?? 0;
                          const tstat = factorResult.tStats[k] ?? 0;
                          const sig   = Math.abs(tstat) > 2;
                          return (
                            <tr key={name} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                              <td style={{ padding: '6px 12px 6px 0', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: FACTOR_COLORS[k % FACTOR_COLORS.length], flexShrink: 0 }} />
                                {name}
                              </td>
                              <td style={{ padding: '6px 12px 6px 0', textAlign: 'right', fontFamily: 'var(--font-mono)', color: beta > 0 ? 'var(--positive)' : beta < 0 ? 'var(--negative)' : 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{beta >= 0 ? '+' : ''}{beta.toFixed(3)}</td>
                              <td style={{ padding: '6px 12px 6px 0', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{(rc * 100).toFixed(1)}%</td>
                              <td style={{ padding: '6px 12px 6px 0', textAlign: 'right', fontFamily: 'var(--font-mono)', color: sig ? 'var(--text-primary)' : 'var(--text-tertiary)', fontWeight: sig ? 500 : 400, fontVariantNumeric: 'tabular-nums' }}>{tstat >= 0 ? '+' : ''}{tstat.toFixed(2)}</td>
                              <td style={{ padding: '6px 0 6px 0', textAlign: 'right', fontFamily: 'var(--font-mono)', color: sig ? 'var(--positive)' : 'var(--text-tertiary)' }}>{sig ? 'yes' : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </RightSection>
          )}

        </div>
      </div>
    </div>
  );
}
