'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button, Card, Input, Select, Slider, Switch } from '@portopt/ui';
import {
  EquityChart, DrawdownChart, WeightEvolution,
  SankeyFlow, Histogram, GroupedBarChart,
} from '@portopt/charts';
import { usePortfolioStore } from '@/lib/stores/portfolio';
import { useBacktestStore, type BacktestConfig } from '@/lib/stores/backtest';
import { useEngine } from '@/lib/wasm/use-engine';
import type { BacktestResult, BootstrapResult, WalkforwardResult } from '@/lib/wasm/types';

// ---------------------------------------------------------------------------
// Colors (raw hex for charts)
// ---------------------------------------------------------------------------

const C = {
  accent:  '#3B82F6',
  positive:'#10B981',
  negative:'#EF4444',
  neutral: '#A1A1A8',
  warning: '#F59E0B',
};

// ---------------------------------------------------------------------------
// Stress periods
// ---------------------------------------------------------------------------

interface StressPeriod { name: string; start: string; end: string; }

const STRESS_PERIODS: StressPeriod[] = [
  { name: 'GFC',         start: '2007-10-01', end: '2009-03-31' },
  { name: 'COVID crash', start: '2020-02-01', end: '2020-04-30' },
  { name: '2022 rates',  start: '2022-01-01', end: '2022-12-31' },
];

// ---------------------------------------------------------------------------
// Helpers (all business logic unchanged)
// ---------------------------------------------------------------------------

const PPY_MAP = { daily: 252, weekly: 52, monthly: 12 } as const;
const annFactor = (f: 'daily' | 'weekly' | 'monthly') => PPY_MAP[f];

function computeMetrics(equity: Float64Array, rets: Float64Array | null, ppy: number, dd: Float64Array) {
  const T = equity.length;
  if (T < 2) return null;
  const cagr = Math.pow(equity[T - 1], ppy / (T - 1)) - 1;
  let annVol = 0;
  if (rets && rets.length > 1) {
    const mean = Array.from(rets).reduce((a, b) => a + b, 0) / rets.length;
    const variance = Array.from(rets).reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
    annVol = Math.sqrt(variance * ppy);
  }
  const maxDd = dd.length > 0 ? Math.min(...Array.from(dd)) : 0;
  const sharpe = annVol > 0 ? cagr / annVol : 0;
  const calmar = maxDd < 0 ? cagr / Math.abs(maxDd) : 0;
  let sortino = 0;
  if (rets && rets.length > 1) {
    const negRets = Array.from(rets).filter((r) => r < 0);
    if (negRets.length > 0) {
      const downDev = Math.sqrt((negRets.reduce((a, b) => a + b ** 2, 0) / negRets.length) * ppy);
      if (downDev > 0) sortino = cagr / downDev;
    }
  }
  return { cagr, annVol, maxDd, sharpe, calmar, sortino };
}

function annualReturns(equity: Float64Array, dates: string[]) {
  const byYear: Record<string, number[]> = {};
  for (let i = 1; i < equity.length && i < dates.length; i++) {
    const yr = (dates[i] ?? '').slice(0, 4);
    if (!yr) continue;
    if (!byYear[yr]) byYear[yr] = [];
    byYear[yr]!.push(equity[i]! / equity[i - 1]! - 1);
  }
  return Object.entries(byYear).map(([year, rets]) => ({
    year,
    ret: rets.reduce((a, b) => (1 + a) * (1 + b) - 1, 0),
  }));
}

interface StressResult {
  name: string; startDate: string; endDate: string;
  series: Array<{ label: string; cumRet: number; maxDD: number; recoveryDays: number | null }>;
}

function computeStressPeriods(periods: StressPeriod[], equityDates: string[], equitySeries: Array<{ label: string; equity: Float64Array }>): StressResult[] {
  const results: StressResult[] = [];
  for (const p of periods) {
    const startIdx = equityDates.findIndex((d) => d >= p.start);
    if (startIdx === -1) continue;
    let endIdx = -1;
    for (let i = equityDates.length - 1; i >= 0; i--) {
      if (equityDates[i]! <= p.end) { endIdx = i; break; }
    }
    if (endIdx === -1 || startIdx >= endIdx) continue;
    const seriesStats = equitySeries.map(({ label, equity }) => {
      const startVal = equity[startIdx] || 1;
      const endVal   = equity[endIdx]   || 1;
      const cumRet   = endVal / startVal - 1;
      let peak = equity[startIdx]!;
      let maxDD = 0;
      for (let i = startIdx; i <= endIdx; i++) {
        if (equity[i]! > peak) peak = equity[i]!;
        const dd = peak > 0 ? equity[i]! / peak - 1 : 0;
        if (dd < maxDD) maxDD = dd;
      }
      let recoveryDays: number | null = null;
      for (let i = endIdx + 1; i < equity.length; i++) {
        if (equity[i]! >= (equity[startIdx] || 1)) {
          recoveryDays = Math.round((new Date(equityDates[i] ?? p.end).getTime() - new Date(equityDates[startIdx] ?? p.start).getTime()) / 86400000);
          break;
        }
      }
      return { label, cumRet, maxDD, recoveryDays };
    });
    results.push({ name: p.name, startDate: equityDates[startIdx] ?? p.start, endDate: equityDates[endIdx] ?? p.end, series: seriesStats });
  }
  return results;
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed = (seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function approxBootstrapSamples(mean: number, ciLower: number, ciUpper: number, n = 2000): number[] {
  const sigma = (ciUpper - ciLower) / (2 * 1.96);
  const rng   = mulberry32(Math.floor(mean * 1e6));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const u1 = Math.max(rng(), 1e-10);
    const u2 = rng();
    out.push(mean + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2));
  }
  return out;
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function toCSV(rows: string[][]): string {
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}

// ---------------------------------------------------------------------------
// Layout primitives (local, duplicated from optimize pattern)
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

// Metric card with surface background (for performance summary)
function PerfMetric({ label, value, color, sub }: { label: string; value: string; color?: 'positive' | 'negative' | 'accent'; sub?: string }) {
  const vc = color === 'positive' ? 'var(--positive)' : color === 'negative' ? 'var(--negative)' : color === 'accent' ? 'var(--accent)' : 'var(--text-primary)';
  return (
    <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-md)', padding: '10px 14px' }}>
      <p style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, marginBottom: 4 }}>{label}</p>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 500, color: vc, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{sub}</p>}
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
// Annual bar
// ---------------------------------------------------------------------------

function AnnualBar({ year, ret }: { year: string; ret: number }) {
  const pct = ret * 100;
  const abs = Math.min(Math.abs(pct), 60);
  const pos = pct >= 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <span style={{ width: 36, flexShrink: 0, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>{year}</span>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1 }} />
        <div style={{ height: 18, width: `${(abs / 60) * 48}%`, background: pos ? C.positive : C.negative, borderRadius: 2, opacity: 0.8 }} />
      </div>
      <span style={{ width: 52, flexShrink: 0, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: pos ? 'var(--positive)' : 'var(--negative)' }}>
        {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BacktestPage() {
  const store          = usePortfolioStore();
  const returns        = store.returns;
  const nPeriods       = store.nPeriods;
  const nAssets        = store.nAssets;
  const tickers        = store.tickers;
  const dates          = store.dates;
  const frequency      = store.frequency;
  const currentWeights = store.currentWeights;

  const { config, result, resultMode, isRunning, error, setConfig, setBenchmarks, setResult, setRunning, setError } = useBacktestStore();
  const engine = useEngine();

  const [hoverIdx,   setHoverIdx]   = useState<number | null>(null);
  const [logScale,   setLogScale]   = useState(false);
  const [sankeyIdx,  setSankeyIdx]  = useState(0);
  const [bootResult,  setBootResult]  = useState<BootstrapResult | null>(null);
  const [bootLoading, setBootLoading] = useState(false);
  const [bootError,   setBootError]   = useState<string | null>(null);
  const [dlFormat,    setDlFormat]    = useState('equity-csv');
  const resultsAreaRef = useRef<HTMLDivElement>(null);

  const hasData = returns !== null && nPeriods > 1;
  const ppy     = annFactor(frequency);
  const nRetPeriods = returns && nAssets > 0 ? Math.floor(returns.length / nAssets) : 0;

  // ── Run backtest ──────────────────────────────────────────────────────────
  const runBacktest = useCallback(async () => {
    if (!returns || nRetPeriods < 2 || nAssets < 1) return;
    setRunning(true); setError(null); setBootResult(null); setSankeyIdx(0);
    try {
      if (config.mode === 'static') {
        const weights = currentWeights ?? new Float64Array(nAssets).fill(1 / nAssets);
        setResult(await engine.runBacktestStatic(returns, nRetPeriods, nAssets, weights, config.benchmarks.ew), 'static');
      } else {
        setResult(await engine.runBacktestWalkforward(returns, nRetPeriods, nAssets, { window: config.window, step: config.step, tc_bps: config.tcBps, slippage_bps: config.slippageBps, long_only: true, ppy }), 'walkforward');
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setRunning(false); }
  }, [returns, nRetPeriods, nAssets, config, currentWeights, ppy, engine, setRunning, setError, setResult]);

  // ── Run bootstrap ─────────────────────────────────────────────────────────
  const runBootstrap = useCallback(async () => {
    if (!result?.portfolioReturns || result.portfolioReturns.length < 30) return;
    setBootLoading(true); setBootError(null);
    try { setBootResult(await engine.bootstrapSharpe(result.portfolioReturns, 0, 2000, 21, 0.95, 42)); }
    catch (e) { setBootError(e instanceof Error ? e.message : String(e)); }
    finally { setBootLoading(false); }
  }, [result, engine]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const equityDates      = useMemo(() => dates.slice(1), [dates]);
  const portfolioMetrics = useMemo(() => result ? computeMetrics(result.portfolioEquity, result.portfolioReturns, ppy, result.portfolioDD) : null, [result, ppy]);
  const ewMetrics        = useMemo(() => { if (!result?.ewEquity) return null; const ewDD = 'ewDD' in result ? (result as BacktestResult).ewDD : null; return ewDD ? computeMetrics(result.ewEquity, null, ppy, ewDD) : null; }, [result, ppy]);
  const equitySeries     = useMemo(() => { if (!result) return []; const s: Array<{ label: string; values: Float64Array; color: string; dashed?: boolean }> = [{ label: 'Strategy', values: result.portfolioEquity, color: C.accent }]; if (result.ewEquity) s.push({ label: 'Equal Weight', values: result.ewEquity, color: C.neutral, dashed: true }); return s; }, [result]);
  const ddSeries         = useMemo(() => { if (!result) return []; const s = [{ label: 'Strategy', values: result.portfolioDD, color: C.negative, fillOpacity: 0.12 }]; const ewDD = 'ewDD' in result ? (result as BacktestResult).ewDD : null; if (ewDD) s.push({ label: 'Equal Weight', values: ewDD, color: C.neutral, fillOpacity: 0.06 }); return s; }, [result]);
  const annRetData       = useMemo(() => result && equityDates.length > 0 ? annualReturns(result.portfolioEquity, equityDates) : [], [result, equityDates]);
  const wfResult         = resultMode === 'walkforward' ? (result as WalkforwardResult | null) : null;
  const rebalanceDates   = useMemo(() => wfResult ? wfResult.rebalanceIndices.map((i) => equityDates[i] ?? `T${i}`) : [], [wfResult, equityDates]);
  const oosStartIdx      = useMemo(() => { if (config.mode !== 'walkforward' || !wfResult) return null; return Math.floor((1 - config.oosFraction) * equityDates.length); }, [config, wfResult, equityDates]);
  const sankeyData       = useMemo(() => { if (!wfResult || rebalanceDates.length < 2) return null; const [, nA] = wfResult.weightsShape; const fromIdx = Math.max(0, Math.min(sankeyIdx, rebalanceDates.length - 2)); const toIdx = fromIdx + 1; return { before: Array.from({ length: nA }, (_, i) => wfResult.weightsHistory[fromIdx * nA + i] ?? 0), after: Array.from({ length: nA }, (_, i) => wfResult.weightsHistory[toIdx * nA + i] ?? 0), fromDate: rebalanceDates[fromIdx] ?? '', toDate: rebalanceDates[toIdx] ?? '', maxIdx: rebalanceDates.length - 2 }; }, [wfResult, rebalanceDates, sankeyIdx]);
  const bootSamples      = useMemo(() => { if (!bootResult || bootResult.mean == null || bootResult.ciLower == null || bootResult.ciUpper == null) return []; return approxBootstrapSamples(bootResult.mean, bootResult.ciLower, bootResult.ciUpper); }, [bootResult]);
  const bootMarkers      = useMemo((): import('@portopt/charts').HistogramMarker[] => { if (!bootResult?.mean || bootResult.ciLower == null || bootResult.ciUpper == null) return []; return [{ value: bootResult.mean, label: `μ=${bootResult.mean.toFixed(2)}`, color: C.accent }, { value: bootResult.ciLower, label: `p2.5=${bootResult.ciLower.toFixed(2)}`, color: C.neutral }, { value: bootResult.ciUpper, label: `p97.5=${bootResult.ciUpper.toFixed(2)}`, color: C.neutral }]; }, [bootResult]);
  const stressData       = useMemo(() => { if (!result || equityDates.length === 0) return []; const s: Array<{ label: string; equity: Float64Array }> = [{ label: 'Strategy', equity: result.portfolioEquity }]; if (result.ewEquity) s.push({ label: 'Equal Weight', equity: result.ewEquity }); return computeStressPeriods(STRESS_PERIODS, equityDates, s); }, [result, equityDates]);
  const stressChartData  = useMemo(() => stressData.map((sp) => ({ group: sp.name, bars: sp.series.map((s, i) => ({ label: s.label, value: s.cumRet, color: i === 0 ? (s.cumRet >= 0 ? C.positive : C.negative) : C.neutral })) })), [stressData]);

  // ── Download ──────────────────────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    if (!result) return;
    if (dlFormat === 'equity-csv') { const header = ['date', 'strategy', ...(result.ewEquity ? ['equal_weight'] : [])]; const rows: string[][] = [header]; for (let i = 0; i < equityDates.length; i++) rows.push([equityDates[i] ?? '', String(result.portfolioEquity[i] ?? ''), ...(result.ewEquity ? [String(result.ewEquity[i] ?? '')] : [])]); downloadBlob(toCSV(rows), 'equity_curves.csv', 'text/csv'); }
    else if (dlFormat === 'weights-csv' && wfResult) { const [, nA] = wfResult.weightsShape; const header = ['date', ...tickers.slice(0, nA)]; const rows: string[][] = [header]; rebalanceDates.forEach((date, ri) => { const row: string[] = [date]; for (let ai = 0; ai < nA; ai++) row.push(String(wfResult.weightsHistory[ri * nA + ai] ?? '')); rows.push(row); }); downloadBlob(toCSV(rows), 'weight_history.csv', 'text/csv'); }
    else if (dlFormat === 'metrics-csv') { downloadBlob(toCSV([['metric','strategy','equal_weight'],['cagr',String(portfolioMetrics?.cagr ?? ''),String(ewMetrics?.cagr ?? '')],['ann_vol',String(portfolioMetrics?.annVol ?? ''),String(ewMetrics?.annVol ?? '')],['max_dd',String(portfolioMetrics?.maxDd ?? ''),String(ewMetrics?.maxDd ?? '')],['sharpe',String(portfolioMetrics?.sharpe ?? ''),String(ewMetrics?.sharpe ?? '')],['calmar',String(portfolioMetrics?.calmar ?? ''),String(ewMetrics?.calmar ?? '')],['sortino',String(portfolioMetrics?.sortino ?? ''),'']]), 'metrics.csv', 'text/csv'); }
    else if (dlFormat === 'json') { downloadBlob(JSON.stringify({ mode: resultMode, equityDates, portfolioEquity: Array.from(result.portfolioEquity), portfolioReturns: Array.from(result.portfolioReturns), portfolioDD: Array.from(result.portfolioDD), ewEquity: result.ewEquity ? Array.from(result.ewEquity) : null, metrics: portfolioMetrics, ewMetrics, ...(wfResult ? { rebalanceDates, weightsHistory: Array.from(wfResult.weightsHistory), weightsShape: wfResult.weightsShape } : {}) }, null, 2), 'backtest.json', 'application/json'); }
  }, [result, dlFormat, equityDates, wfResult, tickers, rebalanceDates, portfolioMetrics, ewMetrics, resultMode]);

  const fmtPct = (v?: number | null) => v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
  const fmtNum = (v?: number | null, d = 2) => v == null ? '—' : v.toFixed(d);
  const setC = <K extends keyof BacktestConfig>(k: K, v: BacktestConfig[K]) => setConfig({ [k]: v } as Partial<BacktestConfig>);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ height: 'calc(100vh - 88px)', display: 'flex', overflow: 'hidden' }}>

      {/* ══ LEFT PANEL ══════════════════════════════════════════════════════ */}
      <aside data-animate style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--border-subtle)', '--stagger': 1, '--delay': '100ms' } as React.CSSProperties}>
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

          {/* Mode */}
          <PanelSection title="Mode">
            <SegCtrl
              options={[{ value: 'static', label: 'Static' }, { value: 'walkforward', label: 'Walk-forward' }]}
              value={config.mode}
              onChange={(v) => setC('mode', v as BacktestConfig['mode'])}
            />
            {config.mode === 'static' && (
              <div className="mt-3">
                <p className="text-[11px] text-tertiary mb-1.5">Strategy weights</p>
                <Select
                  value={config.strategySource}
                  onValueChange={(v) => setC('strategySource', v as BacktestConfig['strategySource'])}
                  options={[{ value: 'current', label: 'Current optimised' }, { value: 'markowitz', label: 'Mean-Variance' }, { value: 'hrp', label: 'HRP' }, { value: 'riskparity', label: 'Risk Parity' }]}
                  className="w-full"
                />
              </div>
            )}
          </PanelSection>

          {/* Window & Step (walk-forward only) */}
          {config.mode === 'walkforward' && (
            <PanelSection title="Lookback & Step">
              <div className="space-y-3">
                <div>
                  <p className="text-[11px] text-tertiary mb-1.5">Lookback window</p>
                  <Select value={String(config.window)} onValueChange={(v) => setC('window', Number(v))}
                    options={[{ value: '63', label: '3 months' }, { value: '126', label: '6 months' }, { value: '252', label: '1 year' }, { value: '504', label: '2 years' }]} className="w-full" />
                </div>
                <div>
                  <p className="text-[11px] text-tertiary mb-1.5">Rebalance step</p>
                  <Select value={String(config.step)} onValueChange={(v) => setC('step', Number(v))}
                    options={[{ value: '21', label: 'Monthly' }, { value: '63', label: 'Quarterly' }, { value: '126', label: 'Semi-annual' }]} className="w-full" />
                </div>
              </div>
            </PanelSection>
          )}

          {/* Transaction Costs */}
          <PanelSection title="Transaction Costs">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[11px] text-tertiary mb-1.5">TC</p>
                <div className="flex items-center gap-1">
                  <Input type="number" value={String(config.tcBps)} onChange={(e) => setC('tcBps', Number(e.target.value))} min={0} max={200} className="flex-1" />
                  <span className="text-[11px] text-tertiary shrink-0">bps</span>
                </div>
              </div>
              <div>
                <p className="text-[11px] text-tertiary mb-1.5">Slippage</p>
                <div className="flex items-center gap-1">
                  <Input type="number" value={String(config.slippageBps)} onChange={(e) => setC('slippageBps', Number(e.target.value))} min={0} max={200} className="flex-1" />
                  <span className="text-[11px] text-tertiary shrink-0">bps</span>
                </div>
              </div>
            </div>
          </PanelSection>

          {/* OOS Split (walk-forward only) */}
          {config.mode === 'walkforward' && (
            <PanelSection title="OOS Split">
              <Slider
                label={`${(config.oosFraction * 100).toFixed(0)}% out-of-sample`}
                value={config.oosFraction}
                min={0.1} max={0.5} step={0.05}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onChange={(v) => setC('oosFraction', v)}
              />
            </PanelSection>
          )}

          {/* Benchmarks */}
          <PanelSection title="Benchmarks">
            <div className="flex items-center justify-between py-0.5">
              <span className="text-[13px] text-secondary">Equal Weight</span>
              <Switch checked={config.benchmarks.ew} onCheckedChange={(v) => setBenchmarks({ ew: v })} />
            </div>
          </PanelSection>

        </div>

        {/* Footer: Run button */}
        <div style={{ flexShrink: 0, borderTop: '1px solid var(--border-subtle)', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Button variant="primary" size="lg" className="w-full" onClick={runBacktest} disabled={!hasData || isRunning} loading={isRunning}>
            {isRunning ? 'Running…' : 'Run Backtest'}
          </Button>
          {!hasData && !isRunning && <p className="text-center text-[11px] text-tertiary">Load portfolio data first</p>}
          {error && <p className="text-center text-[12px] text-negative leading-snug">{error}</p>}
        </div>
      </aside>

      {/* ══ RIGHT PANEL ═════════════════════════════════════════════════════ */}
      <div ref={resultsAreaRef} style={{ flex: 1, minWidth: 0, overflowY: 'auto', paddingBottom: 32 }}>
        <div className="slide-enter-content" style={{ display: 'flex', flexDirection: 'column', gap: 24, '--delay': '100ms' } as React.CSSProperties}>

          {!result && !isRunning && (
            <div style={{ display: 'flex', minHeight: 400, alignItems: 'center', justifyContent: 'center' }}>
              <p style={{ fontSize: 14, color: 'var(--text-tertiary)' }}>Configure parameters and run a backtest to see results.</p>
            </div>
          )}

          {result && (
            <>
              {/* Download bar */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                <Select value={dlFormat} onValueChange={setDlFormat}
                  options={[{ value: 'equity-csv', label: 'Equity CSV' }, ...(wfResult ? [{ value: 'weights-csv', label: 'Weights CSV' }] : []), { value: 'metrics-csv', label: 'Metrics CSV' }, { value: 'json', label: 'Full JSON' }]} />
                <Button variant="secondary" size="sm" onClick={handleDownload}>Download</Button>
              </div>

              {/* A — Performance summary */}
              <div>
                <p className="text-h3" style={{ color: 'var(--text-tertiary)', marginBottom: 12 }}>Performance Summary</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 12 }}>
                  <PerfMetric label="CAGR"       value={fmtPct(portfolioMetrics?.cagr)}   color={portfolioMetrics && portfolioMetrics.cagr >= 0 ? 'positive' : 'negative'} />
                  <PerfMetric label="Ann. Vol"   value={portfolioMetrics ? `${(portfolioMetrics.annVol * 100).toFixed(2)}%` : '—'} />
                  <PerfMetric label="Max DD"     value={portfolioMetrics ? `${(portfolioMetrics.maxDd * 100).toFixed(2)}%` : '—'} color="negative" />
                  <PerfMetric label="Sharpe"     value={fmtNum(portfolioMetrics?.sharpe)}  color="accent" />
                  <PerfMetric label="Calmar"     value={fmtNum(portfolioMetrics?.calmar)} />
                  <PerfMetric label="Sortino"    value={fmtNum(portfolioMetrics?.sortino)} />
                </div>
                {ewMetrics && (
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '10px 16px', display: 'flex', gap: 24 }}>
                    <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginRight: 8, alignSelf: 'center' }}>EW benchmark</p>
                    {[{ l: 'CAGR', v: fmtPct(ewMetrics.cagr) }, { l: 'Vol', v: `${(ewMetrics.annVol * 100).toFixed(2)}%` }, { l: 'Max DD', v: `${(ewMetrics.maxDd * 100).toFixed(2)}%` }, { l: 'Sharpe', v: fmtNum(ewMetrics.sharpe) }].map(({ l, v }) => (
                      <span key={l} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{l} <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{v}</span></span>
                    ))}
                  </div>
                )}
              </div>

              {/* B — Equity curve */}
              <RightSection title="Equity Curve">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 16, marginBottom: 12 }}>
                  <div style={{ display: 'flex', gap: 16 }}>
                    {equitySeries.map((s) => (
                      <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                        <span style={{ display: 'inline-block', width: 16, height: 2, background: (s as { dashed?: boolean }).dashed ? 'none' : s.color, borderTop: (s as { dashed?: boolean }).dashed ? `1.5px dashed ${s.color}` : undefined }} />
                        {s.label}
                      </span>
                    ))}
                  </div>
                  <button onClick={() => setLogScale(!logScale)}
                    className={['h-6 px-2 rounded text-[11px] border transition-colors duration-[var(--duration-micro)]', logScale ? 'border-accent/40 text-accent' : 'border-[var(--border-subtle)] text-tertiary hover:text-secondary'].join(' ')}>
                    Log
                  </button>
                </div>
                <EquityChart series={equitySeries} dates={equityDates} oosStartIdx={oosStartIdx} logScale={logScale} hoverIdx={hoverIdx} onHover={setHoverIdx} height={360} />
              </RightSection>

              {/* C — Drawdown */}
              <RightSection title="Drawdown">
                <DrawdownChart series={ddSeries} dates={equityDates} hoverIdx={hoverIdx} onHover={setHoverIdx} height={200} />
              </RightSection>

              {/* D — Annual returns */}
              {annRetData.length > 0 && (
                <RightSection title="Annual Returns">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {annRetData.map(({ year, ret }) => <AnnualBar key={year} year={year} ret={ret} />)}
                  </div>
                </RightSection>
              )}

              {/* E — Weight evolution (walk-forward) */}
              {wfResult && rebalanceDates.length > 0 && (
                <RightSection title="Weight Evolution">
                  <WeightEvolution weightsHistory={wfResult.weightsHistory} weightsShape={wfResult.weightsShape} rebalanceDates={rebalanceDates} tickers={tickers} height={240} />
                </RightSection>
              )}

              {/* F — Rebalance history */}
              {wfResult && rebalanceDates.length > 0 && (
                <RightSection title="Rebalance History">
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <th style={{ padding: '6px 12px 6px 0', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', fontWeight: 500 }}>Date</th>
                          {tickers.slice(0, wfResult.weightsShape[1]).map((t) => (
                            <th key={t} style={{ padding: '6px 8px 6px 0', textAlign: 'right', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', fontWeight: 500 }}>{t}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rebalanceDates.map((date, ri) => {
                          const nA = wfResult.weightsShape[1];
                          return (
                            <tr key={ri} style={{ borderBottom: '1px solid var(--border-subtle)', background: ri % 2 === 1 ? 'color-mix(in srgb, var(--bg-inset) 50%, transparent)' : 'transparent' }}>
                              <td style={{ padding: '6px 12px 6px 0', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{date}</td>
                              {tickers.slice(0, nA).map((t, ai) => (
                                <td key={t} style={{ padding: '6px 8px 6px 0', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                                  {((wfResult.weightsHistory[ri * nA + ai] ?? 0) * 100).toFixed(1)}%
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </RightSection>
              )}

              {/* G — Sankey (walk-forward) */}
              {sankeyData && (
                <RightSection title="Rebalancing Flows">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>{sankeyData.fromDate} → {sankeyData.toDate}</span>
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <Slider label={`Transition ${sankeyIdx + 1} of ${sankeyData.maxIdx + 1}`} value={sankeyIdx} min={0} max={sankeyData.maxIdx} step={1} format={(v) => `${Math.round(v) + 1} / ${sankeyData.maxIdx + 1}`} onChange={(v) => setSankeyIdx(Math.round(v))} />
                  </div>
                  <SankeyFlow beforeWeights={sankeyData.before} afterWeights={sankeyData.after} tickers={tickers.slice(0, sankeyData.before.length)} beforeDate={sankeyData.fromDate} afterDate={sankeyData.toDate} height={320} />
                </RightSection>
              )}

              {/* H — Bootstrap Sharpe */}
              <RightSection title="Bootstrap Sharpe Significance">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 12 }}>
                  <Button variant="secondary" size="sm" onClick={runBootstrap} disabled={bootLoading || !result?.portfolioReturns} loading={bootLoading}>
                    {bootLoading ? 'Computing…' : 'Compute CI'}
                  </Button>
                </div>
                {!bootResult && !bootLoading && <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Run bootstrap to estimate Sharpe confidence interval (n=2000, block=21).</p>}
                {bootError && <p style={{ fontSize: 12, color: 'var(--negative)' }}>{bootError}</p>}
                {bootResult && (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
                      <PerfMetric label="Mean Sharpe"   value={fmtNum(bootResult.mean)}    color="accent" />
                      <PerfMetric label="Lower 95% CI"  value={fmtNum(bootResult.ciLower)} color={bootResult.ciLower != null && bootResult.ciLower > 0 ? 'positive' : undefined} />
                      <PerfMetric label="Upper 95% CI"  value={fmtNum(bootResult.ciUpper)} />
                    </div>
                    <div style={{ marginBottom: 16, borderRadius: 'var(--radius-md)', padding: '10px 14px', border: '1px solid var(--border-subtle)', fontSize: 13, background: bootResult.ciLower != null && bootResult.ciLower > 0 ? 'rgba(16,185,129,0.06)' : 'transparent', color: bootResult.ciLower != null && bootResult.ciLower > 0 ? 'var(--positive)' : 'var(--text-tertiary)' }}>
                      {bootResult.ciLower != null && bootResult.ciLower > 0 ? 'Statistically significant positive Sharpe (lower 95% CI > 0)' : 'Sharpe not statistically different from zero at 95% confidence'}
                    </div>
                    {bootSamples.length > 0 && <Histogram values={bootSamples} nBins={40} xLabel="Sharpe ratio" markers={bootMarkers} height={180} barColor={C.accent} />}
                  </>
                )}
              </RightSection>

              {/* I — Stress periods */}
              {stressData.length > 0 && (
                <RightSection title="Stress Period Analysis">
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
                              <td style={{ padding: '6px 12px 6px 0', color: 'var(--text-secondary)', verticalAlign: 'top' }} rowSpan={sp.series.length}>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
