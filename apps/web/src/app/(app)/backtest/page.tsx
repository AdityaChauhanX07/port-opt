'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Button, Card, Input, Select, Slider } from '@portopt/ui';
import {
  EquityChart, DrawdownChart, WeightEvolution,
  SankeyFlow, Histogram, GroupedBarChart,
} from '@portopt/charts';
import { usePortfolioStore } from '@/lib/stores/portfolio';
import { useBacktestStore, type BacktestConfig } from '@/lib/stores/backtest';
import { useEngine } from '@/lib/wasm/use-engine';
import type { BacktestResult, BootstrapResult, WalkforwardResult } from '@/lib/wasm/types';

// ---------------------------------------------------------------------------
// Token hex values for use in D3 chart series (CSS vars inaccessible in SVG attr)
// ---------------------------------------------------------------------------

const C: Record<string, string> = {
  accent:  '#5e8eff',
  gain:    '#3fb950',
  loss:    '#f85149',
  neutral: '#8b949e',
  amber:   '#f59e0b',
};

// ---------------------------------------------------------------------------
// Stress periods
// ---------------------------------------------------------------------------

interface StressPeriod {
  name:  string;
  start: string;
  end:   string;
}

const STRESS_PERIODS: StressPeriod[] = [
  { name: 'GFC',          start: '2007-10-01', end: '2009-03-31' },
  { name: 'COVID crash',  start: '2020-02-01', end: '2020-04-30' },
  { name: '2022 rates',   start: '2022-01-01', end: '2022-12-31' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PPY_MAP = { daily: 252, weekly: 52, monthly: 12 } as const;
const annFactor = (f: 'daily' | 'weekly' | 'monthly') => PPY_MAP[f];

function computeMetrics(
  equity: Float64Array,
  rets: Float64Array | null,
  ppy: number,
  dd: Float64Array,
) {
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
    byYear[yr].push(equity[i] / equity[i - 1] - 1);
  }
  return Object.entries(byYear).map(([year, rets]) => ({
    year,
    ret: rets.reduce((a, b) => (1 + a) * (1 + b) - 1, 0),
  }));
}

interface StressResult {
  name:        string;
  startDate:   string;
  endDate:     string;
  series: Array<{
    label:        string;
    cumRet:       number;
    maxDD:        number;
    recoveryDays: number | null;
  }>;
}

function computeStressPeriods(
  periods: StressPeriod[],
  equityDates: string[],
  equitySeries: Array<{ label: string; equity: Float64Array }>,
): StressResult[] {
  const results: StressResult[] = [];
  for (const p of periods) {
    const startIdx = equityDates.findIndex((d) => d >= p.start);
    if (startIdx === -1) continue;
    let endIdx = -1;
    for (let i = equityDates.length - 1; i >= 0; i--) {
      if (equityDates[i] <= p.end) { endIdx = i; break; }
    }
    if (endIdx === -1 || startIdx >= endIdx) continue;

    const seriesStats = equitySeries.map(({ label, equity }) => {
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
      const preLevel = equity[startIdx];
      for (let i = endIdx + 1; i < equity.length; i++) {
        if (equity[i] >= preLevel) {
          const a = new Date(equityDates[startIdx] ?? p.start);
          const b = new Date(equityDates[i]        ?? p.end);
          recoveryDays = Math.round((b.getTime() - a.getTime()) / 86400000);
          break;
        }
      }
      return { label, cumRet, maxDD, recoveryDays };
    });

    results.push({
      name:      p.name,
      startDate: equityDates[startIdx] ?? p.start,
      endDate:   equityDates[endIdx]   ?? p.end,
      series:    seriesStats,
    });
  }
  return results;
}

/** Mulberry32 seeded PRNG — deterministic given same input. */
function mulberry32(seed: number) {
  return function () {
    let t = (seed = (seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Approximate bootstrap samples via N(mean, sigma²) for histogram display. */
function approxBootstrapSamples(
  mean: number,
  ciLower: number,
  ciUpper: number,
  n = 2000,
): number[] {
  const sigma = (ciUpper - ciLower) / (2 * 1.96);
  const rng   = mulberry32(Math.floor(mean * 1e6));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const u1 = Math.max(rng(), 1e-10);
    const u2 = rng();
    const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    out.push(mean + sigma * z);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Download helpers
// ---------------------------------------------------------------------------

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCSV(rows: string[][]): string {
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-tertiary mb-3">
      {children}
    </p>
  );
}

function MetricCard({
  label,
  value,
  variant = 'default',
  sub,
}: {
  label:    string;
  value:    string;
  variant?: 'default' | 'gain' | 'loss' | 'accent';
  sub?:     string;
}) {
  const colorCls =
    variant === 'gain'   ? 'text-gain'   :
    variant === 'loss'   ? 'text-loss'   :
    variant === 'accent' ? 'text-accent' :
    'text-primary';
  return (
    <div className="flex flex-col gap-1 rounded-md bg-subtle px-4 py-3">
      <span className="text-[11px] uppercase tracking-[0.05em] text-tertiary">{label}</span>
      <span className={`mono text-lg font-medium tabular-nums leading-none ${colorCls}`}>
        {value}
      </span>
      {sub && <span className="text-[11px] text-tertiary">{sub}</span>}
    </div>
  );
}

function AnnualBar({ year, ret }: { year: string; ret: number }) {
  const pct      = ret * 100;
  const abs      = Math.min(Math.abs(pct), 60);
  const positive = pct >= 0;
  const w        = `${(abs / 60) * 48}%`;
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="w-10 shrink-0 text-right text-tertiary tabular-nums">{year}</span>
      <div className="flex flex-1 items-center">
        <div className="flex-1" />
        <div
          className="h-5 rounded-sm"
          style={{ width: w, background: positive ? C.gain : C.loss, opacity: 0.75 }}
        />
      </div>
      <span className={`w-14 shrink-0 tabular-nums font-medium ${positive ? 'text-gain' : 'text-loss'}`}>
        {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function BacktestPage() {
  const { returns, nPeriods, nAssets, tickers, dates, frequency, currentWeights } =
    usePortfolioStore((s) => ({
      returns:        s.returns,
      nPeriods:       s.nPeriods,
      nAssets:        s.nAssets,
      tickers:        s.tickers,
      dates:          s.dates,
      frequency:      s.frequency,
      currentWeights: s.currentWeights,
    }));

  const {
    config, result, resultMode, isRunning, error,
    setConfig, setBenchmarks, setResult, setRunning, setError,
  } = useBacktestStore();

  const engine = useEngine();

  // Core display state
  const [hoverIdx,   setHoverIdx]   = useState<number | null>(null);
  const [logScale,   setLogScale]   = useState(false);

  // Section H — Sankey
  const [sankeyIdx,  setSankeyIdx]  = useState(0);

  // Section I — Bootstrap Sharpe
  const [bootResult,   setBootResult]   = useState<BootstrapResult | null>(null);
  const [bootLoading,  setBootLoading]  = useState(false);
  const [bootError,    setBootError]    = useState<string | null>(null);

  // Download
  const [dlFormat,   setDlFormat]   = useState('equity-csv');
  const resultsAreaRef = useRef<HTMLDivElement>(null);

  const hasData = returns !== null && nPeriods > 1;
  const ppy     = annFactor(frequency);

  // ── Run backtest ──────────────────────────────────────────────────────────

  const runBacktest = useCallback(async () => {
    if (!returns || nPeriods < 2 || nAssets < 1) return;
    setRunning(true);
    setError(null);
    // Reset analytics state when re-running
    setBootResult(null);
    setSankeyIdx(0);
    try {
      if (config.mode === 'static') {
        const weights = currentWeights ?? new Float64Array(nAssets).fill(1 / nAssets);
        const res = await engine.runBacktestStatic(
          returns, nPeriods, nAssets, weights, config.benchmarks.ew,
        );
        setResult(res, 'static');
      } else {
        const res = await engine.runBacktestWalkforward(returns, nPeriods, nAssets, {
          window:       config.window,
          step:         config.step,
          tc_bps:       config.tcBps,
          slippage_bps: config.slippageBps,
          long_only:    true,
          ppy,
        });
        setResult(res, 'walkforward');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [returns, nPeriods, nAssets, config, currentWeights, ppy, engine, setRunning, setError, setResult]);

  // ── Run bootstrap ─────────────────────────────────────────────────────────

  const runBootstrap = useCallback(async () => {
    if (!result?.portfolioReturns || result.portfolioReturns.length < 30) return;
    setBootLoading(true);
    setBootError(null);
    try {
      const res = await engine.bootstrapSharpe(
        result.portfolioReturns,
        0,    // rf per period (use 0 for simplicity)
        2000,
        21,
        0.95,
        42,
      );
      setBootResult(res);
    } catch (e) {
      setBootError(e instanceof Error ? e.message : String(e));
    } finally {
      setBootLoading(false);
    }
  }, [result, engine]);

  // ── Derived data ──────────────────────────────────────────────────────────

  const equityDates = useMemo(() => dates.slice(1), [dates]);

  const portfolioMetrics = useMemo(
    () => result
      ? computeMetrics(result.portfolioEquity, result.portfolioReturns, ppy, result.portfolioDD)
      : null,
    [result, ppy],
  );

  const ewMetrics = useMemo(() => {
    if (!result?.ewEquity) return null;
    const ewDD = 'ewDD' in result ? (result as BacktestResult).ewDD : null;
    return ewDD ? computeMetrics(result.ewEquity, null, ppy, ewDD) : null;
  }, [result, ppy]);

  const equitySeries = useMemo(() => {
    if (!result) return [];
    const s: Array<{ label: string; values: Float64Array; color: string; dashed?: boolean }> = [
      { label: 'Strategy', values: result.portfolioEquity, color: C.accent },
    ];
    if (result.ewEquity) {
      s.push({ label: 'Equal Weight', values: result.ewEquity, color: C.neutral, dashed: true });
    }
    return s;
  }, [result]);

  const ddSeries = useMemo(() => {
    if (!result) return [];
    const s = [{ label: 'Strategy', values: result.portfolioDD, color: C.loss, fillOpacity: 0.12 }];
    const ewDD = 'ewDD' in result ? (result as BacktestResult).ewDD : null;
    if (ewDD) s.push({ label: 'Equal Weight', values: ewDD, color: C.neutral, fillOpacity: 0.06 });
    return s;
  }, [result]);

  const annRetData = useMemo(
    () => result && equityDates.length > 0 ? annualReturns(result.portfolioEquity, equityDates) : [],
    [result, equityDates],
  );

  const wfResult       = resultMode === 'walkforward' ? (result as WalkforwardResult | null) : null;

  const rebalanceDates = useMemo(
    () => wfResult ? wfResult.rebalanceIndices.map((i) => equityDates[i] ?? `T${i}`) : [],
    [wfResult, equityDates],
  );

  const oosStartIdx = useMemo(() => {
    if (config.mode !== 'walkforward' || !wfResult) return null;
    return Math.floor((1 - config.oosFraction) * equityDates.length);
  }, [config, wfResult, equityDates]);

  // Section H — Sankey data
  const sankeyData = useMemo(() => {
    if (!wfResult || rebalanceDates.length < 2) return null;
    const [, nA]  = wfResult.weightsShape;
    const fromIdx = Math.max(0, Math.min(sankeyIdx, rebalanceDates.length - 2));
    const toIdx   = fromIdx + 1;
    const before  = Array.from({ length: nA }, (_, i) => wfResult.weightsHistory[fromIdx * nA + i] ?? 0);
    const after   = Array.from({ length: nA }, (_, i) => wfResult.weightsHistory[toIdx   * nA + i] ?? 0);
    return {
      before,
      after,
      fromDate: rebalanceDates[fromIdx] ?? '',
      toDate:   rebalanceDates[toIdx]   ?? '',
      maxIdx:   rebalanceDates.length - 2,
    };
  }, [wfResult, rebalanceDates, sankeyIdx]);

  // Section I — Bootstrap histogram
  const bootSamples = useMemo(() => {
    if (
      !bootResult ||
      bootResult.mean    == null ||
      bootResult.ciLower == null ||
      bootResult.ciUpper == null
    ) return [];
    return approxBootstrapSamples(bootResult.mean, bootResult.ciLower, bootResult.ciUpper);
  }, [bootResult]);

  const bootMarkers = useMemo((): import('@portopt/charts').HistogramMarker[] => {
    if (!bootResult?.mean || bootResult.ciLower == null || bootResult.ciUpper == null) return [];
    return [
      { value: bootResult.mean,    label: `μ=${bootResult.mean.toFixed(2)}`,       color: C.accent },
      { value: bootResult.ciLower, label: `p2.5=${bootResult.ciLower.toFixed(2)}`, color: C.neutral },
      { value: bootResult.ciUpper, label: `p97.5=${bootResult.ciUpper.toFixed(2)}`, color: C.neutral },
    ];
  }, [bootResult]);

  // Section J — Stress periods
  const stressData = useMemo(() => {
    if (!result || equityDates.length === 0) return [];
    const series: Array<{ label: string; equity: Float64Array }> = [
      { label: 'Strategy', equity: result.portfolioEquity },
    ];
    if (result.ewEquity) {
      series.push({ label: 'Equal Weight', equity: result.ewEquity });
    }
    return computeStressPeriods(STRESS_PERIODS, equityDates, series);
  }, [result, equityDates]);

  const stressChartData = useMemo(() => {
    return stressData.map((sp) => ({
      group: sp.name,
      bars: sp.series.map((s, i) => ({
        label: s.label,
        value: s.cumRet,
        color: i === 0 ? (s.cumRet >= 0 ? C.gain : C.loss) : C.neutral,
      })),
    }));
  }, [stressData]);

  // ── Download ──────────────────────────────────────────────────────────────

  const handleDownload = useCallback(() => {
    if (!result) return;

    if (dlFormat === 'equity-csv') {
      const header = ['date', 'strategy', ...(result.ewEquity ? ['equal_weight'] : [])];
      const rows: string[][] = [header];
      for (let i = 0; i < equityDates.length; i++) {
        const row: string[] = [
          equityDates[i] ?? '',
          String(result.portfolioEquity[i] ?? ''),
          ...(result.ewEquity ? [String(result.ewEquity[i] ?? '')] : []),
        ];
        rows.push(row);
      }
      downloadBlob(toCSV(rows), 'equity_curves.csv', 'text/csv');

    } else if (dlFormat === 'weights-csv') {
      if (!wfResult) return;
      const [, nA] = wfResult.weightsShape;
      const header = ['date', ...tickers.slice(0, nA)];
      const rows: string[][] = [header];
      rebalanceDates.forEach((date, ri) => {
        const row: string[] = [date];
        for (let ai = 0; ai < nA; ai++) {
          row.push(String(wfResult.weightsHistory[ri * nA + ai] ?? ''));
        }
        rows.push(row);
      });
      downloadBlob(toCSV(rows), 'weight_history.csv', 'text/csv');

    } else if (dlFormat === 'metrics-csv') {
      const rows: string[][] = [
        ['metric', 'strategy', 'equal_weight'],
        ['cagr',      String(portfolioMetrics?.cagr   ?? ''), String(ewMetrics?.cagr   ?? '')],
        ['ann_vol',   String(portfolioMetrics?.annVol  ?? ''), String(ewMetrics?.annVol  ?? '')],
        ['max_dd',    String(portfolioMetrics?.maxDd   ?? ''), String(ewMetrics?.maxDd   ?? '')],
        ['sharpe',    String(portfolioMetrics?.sharpe  ?? ''), String(ewMetrics?.sharpe  ?? '')],
        ['calmar',    String(portfolioMetrics?.calmar  ?? ''), String(ewMetrics?.calmar  ?? '')],
        ['sortino',   String(portfolioMetrics?.sortino ?? ''), ''],
      ];
      downloadBlob(toCSV(rows), 'metrics.csv', 'text/csv');

    } else if (dlFormat === 'json') {
      const payload = {
        mode:             resultMode,
        equityDates,
        portfolioEquity:  Array.from(result.portfolioEquity),
        portfolioReturns: Array.from(result.portfolioReturns),
        portfolioDD:      Array.from(result.portfolioDD),
        ewEquity:         result.ewEquity ? Array.from(result.ewEquity) : null,
        metrics:          portfolioMetrics,
        ewMetrics,
        ...(wfResult ? {
          rebalanceDates,
          weightsHistory: Array.from(wfResult.weightsHistory),
          weightsShape:   wfResult.weightsShape,
        } : {}),
      };
      downloadBlob(JSON.stringify(payload, null, 2), 'backtest.json', 'application/json');
    }
  }, [
    result, dlFormat, equityDates, wfResult, tickers, rebalanceDates,
    portfolioMetrics, ewMetrics, resultMode,
  ]);

  // ── Format ────────────────────────────────────────────────────────────────

  const fmtPct = (v?: number | null) =>
    v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
  const fmtNum = (v?: number | null, d = 2) =>
    v == null ? '—' : v.toFixed(d);

  const setC = <K extends keyof BacktestConfig>(k: K, v: BacktestConfig[K]) =>
    setConfig({ [k]: v } as Partial<BacktestConfig>);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full">
      {/* ── Config panel ──────────────────────────────────────────────────── */}
      <aside className="w-[320px] shrink-0 overflow-y-auto hairline-r py-5 px-4 space-y-6">

        {/* 1 — Mode */}
        <div>
          <SectionLabel>Mode</SectionLabel>
          <div className="flex gap-2">
            {(['static', 'walkforward'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setC('mode', m)}
                className={[
                  'flex-1 h-8 rounded text-[13px] border transition-colors duration-[var(--duration-fast)]',
                  config.mode === m
                    ? 'bg-accent/10 border-accent/30 text-accent'
                    : 'border-[var(--border)] text-secondary hover:text-primary hover:bg-[var(--bg-hover)]',
                ].join(' ')}
              >
                {m === 'static' ? 'Static' : 'Walk-forward'}
              </button>
            ))}
          </div>
        </div>

        {/* 2 — Strategy source (static only) */}
        {config.mode === 'static' && (
          <div>
            <SectionLabel>Strategy weights</SectionLabel>
            <Select
              value={config.strategySource}
              onValueChange={(v) => setC('strategySource', v as BacktestConfig['strategySource'])}
              options={[
                { value: 'current',    label: 'Current optimised' },
                { value: 'markowitz',  label: 'Mean-Variance' },
                { value: 'hrp',        label: 'HRP' },
                { value: 'riskparity', label: 'Risk Parity' },
              ]}
              placeholder="Select strategy"
            />
          </div>
        )}

        {/* 3 — Window & Step (walkforward only) */}
        {config.mode === 'walkforward' && (
          <div className="space-y-4">
            <div>
              <SectionLabel>Lookback window</SectionLabel>
              <Select
                value={String(config.window)}
                onValueChange={(v) => setC('window', Number(v))}
                options={[
                  { value: '63',  label: '3 months (63 periods)' },
                  { value: '126', label: '6 months (126 periods)' },
                  { value: '252', label: '1 year (252 periods)' },
                  { value: '504', label: '2 years (504 periods)' },
                ]}
                placeholder="Select window"
              />
            </div>
            <div>
              <SectionLabel>Rebalance step</SectionLabel>
              <Select
                value={String(config.step)}
                onValueChange={(v) => setC('step', Number(v))}
                options={[
                  { value: '21',  label: 'Monthly (21 periods)' },
                  { value: '63',  label: 'Quarterly (63 periods)' },
                  { value: '126', label: 'Semi-annual (126 periods)' },
                ]}
                placeholder="Select step"
              />
            </div>
          </div>
        )}

        {/* 4 — Transaction costs */}
        <div>
          <SectionLabel>Transaction costs</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[12px] text-secondary mb-1.5">TC (bps)</p>
              <Input
                type="number"
                value={String(config.tcBps)}
                onChange={(e) => setC('tcBps', Number(e.target.value))}
                min={0}
                max={200}
              />
            </div>
            <div>
              <p className="text-[12px] text-secondary mb-1.5">Slippage (bps)</p>
              <Input
                type="number"
                value={String(config.slippageBps)}
                onChange={(e) => setC('slippageBps', Number(e.target.value))}
                min={0}
                max={200}
              />
            </div>
          </div>
        </div>

        {/* 5 — OOS fraction (walkforward only) */}
        {config.mode === 'walkforward' && (
          <div>
            <SectionLabel>
              Out-of-sample —{' '}
              <span className="text-primary normal-case tracking-normal">
                {(config.oosFraction * 100).toFixed(0)}%
              </span>
            </SectionLabel>
            <Slider
              label={`${(config.oosFraction * 100).toFixed(0)}% OOS`}
              value={config.oosFraction}
              min={0.1}
              max={0.5}
              step={0.05}
              onChange={(v) => setC('oosFraction', v)}
            />
            <div className="flex justify-between text-[11px] text-tertiary mt-1.5">
              <span>10%</span><span>50%</span>
            </div>
          </div>
        )}

        {/* 6 — Benchmarks */}
        <div>
          <SectionLabel>Benchmarks</SectionLabel>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={config.benchmarks.ew}
              onChange={(e) => setBenchmarks({ ew: e.target.checked })}
              className="h-3.5 w-3.5 rounded accent-[var(--accent)]"
            />
            <span className="text-[13px] text-secondary">Equal Weight</span>
          </label>
        </div>

        {/* 7 — Run */}
        <div className="pt-2 border-t border-[var(--border)]">
          <Button
            variant="primary"
            size="md"
            className="w-full"
            onClick={runBacktest}
            disabled={!hasData || isRunning}
            loading={isRunning}
          >
            {isRunning ? 'Running…' : 'Run Backtest'}
          </Button>
          {!hasData && (
            <p className="mt-2 text-[12px] text-tertiary text-center">
              Load portfolio data first
            </p>
          )}
          {error && (
            <p className="mt-2 text-[12px] text-loss text-center leading-snug">{error}</p>
          )}
        </div>
      </aside>

      {/* ── Results area ──────────────────────────────────────────────────── */}
      <div ref={resultsAreaRef} className="flex-1 overflow-y-auto p-6 space-y-6">

        {!result && !isRunning && (
          <div className="flex h-full min-h-[400px] items-center justify-center">
            <p className="text-[14px] text-tertiary">
              Configure parameters and run a backtest to see results.
            </p>
          </div>
        )}

        {result && (
          <>
            {/* ── Download bar ──────────────────────────────────────────── */}
            <div className="flex items-center justify-end gap-2">
              <Select
                value={dlFormat}
                onValueChange={setDlFormat}
                options={[
                  { value: 'equity-csv',  label: 'Equity curves CSV' },
                  ...(wfResult ? [{ value: 'weights-csv', label: 'Weight history CSV' }] : []),
                  { value: 'metrics-csv', label: 'Metrics table CSV' },
                  { value: 'json',        label: 'Full backtest JSON' },
                ]}
                placeholder="Format"
              />
              <Button variant="secondary" size="sm" onClick={handleDownload}>
                Download
              </Button>
            </div>

            {/* A — Performance summary */}
            <section>
              <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-tertiary mb-3">
                Performance summary
              </p>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <MetricCard
                  label="CAGR"
                  value={fmtPct(portfolioMetrics?.cagr)}
                  variant={portfolioMetrics && portfolioMetrics.cagr >= 0 ? 'gain' : 'loss'}
                />
                <MetricCard
                  label="Ann. Volatility"
                  value={portfolioMetrics ? `${(portfolioMetrics.annVol * 100).toFixed(2)}%` : '—'}
                />
                <MetricCard
                  label="Max Drawdown"
                  value={portfolioMetrics ? `${(portfolioMetrics.maxDd * 100).toFixed(2)}%` : '—'}
                  variant="loss"
                />
                <MetricCard label="Sharpe"  value={fmtNum(portfolioMetrics?.sharpe)}  variant="accent" />
                <MetricCard label="Calmar"  value={fmtNum(portfolioMetrics?.calmar)}  />
                <MetricCard label="Sortino" value={fmtNum(portfolioMetrics?.sortino)} />
              </div>

              {ewMetrics && (
                <div className="rounded-md border border-[var(--border)] px-4 py-3">
                  <p className="text-[11px] text-tertiary mb-2">Equal Weight benchmark</p>
                  <div className="grid grid-cols-4 gap-4 text-[12px]">
                    {[
                      { label: 'CAGR',   val: fmtPct(ewMetrics.cagr) },
                      { label: 'Vol',    val: `${(ewMetrics.annVol * 100).toFixed(2)}%` },
                      { label: 'Max DD', val: `${(ewMetrics.maxDd * 100).toFixed(2)}%` },
                      { label: 'Sharpe', val: fmtNum(ewMetrics.sharpe) },
                    ].map(({ label, val }) => (
                      <div key={label}>
                        <span className="text-tertiary">{label} </span>
                        <span className="mono text-secondary">{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* B — Equity curve */}
            <Card>
              <div className="flex items-center justify-between mb-4">
                <p className="text-[13px] font-medium text-primary">Equity Curve</p>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-3 text-[12px] text-secondary">
                    {equitySeries.map((s) => (
                      <span key={s.label} className="flex items-center gap-1.5">
                        <span
                          className="inline-block w-4"
                          style={{
                            height: 2,
                            background: (s as { dashed?: boolean }).dashed ? 'none' : s.color,
                            borderTop: (s as { dashed?: boolean }).dashed
                              ? `2px dashed ${s.color}` : undefined,
                          }}
                        />
                        {s.label}
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={() => setLogScale(!logScale)}
                    className={[
                      'h-6 px-2 rounded text-[11px] border transition-colors duration-[var(--duration-fast)]',
                      logScale
                        ? 'border-accent/40 text-accent bg-accent/10'
                        : 'border-[var(--border)] text-tertiary hover:text-secondary',
                    ].join(' ')}
                  >
                    Log
                  </button>
                </div>
              </div>
              <EquityChart
                series={equitySeries}
                dates={equityDates}
                oosStartIdx={oosStartIdx}
                logScale={logScale}
                hoverIdx={hoverIdx}
                onHover={setHoverIdx}
                height={260}
              />
            </Card>

            {/* C — Drawdown */}
            <Card>
              <p className="text-[13px] font-medium text-primary mb-4">Drawdown</p>
              <DrawdownChart
                series={ddSeries}
                dates={equityDates}
                hoverIdx={hoverIdx}
                onHover={setHoverIdx}
                height={160}
              />
            </Card>

            {/* D — Annual returns */}
            {annRetData.length > 0 && (
              <Card>
                <p className="text-[13px] font-medium text-primary mb-4">Annual Returns</p>
                <div className="space-y-1.5">
                  {annRetData.map(({ year, ret }) => (
                    <AnnualBar key={year} year={year} ret={ret} />
                  ))}
                </div>
              </Card>
            )}

            {/* E — Weight evolution (walkforward) */}
            {wfResult && rebalanceDates.length > 0 && (
              <Card>
                <p className="text-[13px] font-medium text-primary mb-4">Weight Evolution</p>
                <WeightEvolution
                  weightsHistory={wfResult.weightsHistory}
                  weightsShape={wfResult.weightsShape}
                  rebalanceDates={rebalanceDates}
                  tickers={tickers}
                  height={220}
                />
              </Card>
            )}

            {/* F — Rebalance table (walkforward) */}
            {wfResult && rebalanceDates.length > 0 && (
              <Card>
                <p className="text-[13px] font-medium text-primary mb-4">Rebalance History</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="hairline-b">
                        <th className="py-2 pr-4 text-left text-[11px] uppercase tracking-[0.05em] text-tertiary">
                          Date
                        </th>
                        {tickers.slice(0, wfResult.weightsShape[1]).map((t) => (
                          <th key={t} className="py-2 pr-3 text-right text-[11px] uppercase tracking-[0.05em] text-tertiary">
                            {t}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rebalanceDates.map((date, ri) => {
                        const nA = wfResult.weightsShape[1];
                        return (
                          <tr key={ri} className="hairline-b last:border-0 hover:bg-[var(--bg-hover)]">
                            <td className="py-2 pr-4 text-secondary">{date}</td>
                            {tickers.slice(0, nA).map((t, ai) => {
                              const w = wfResult.weightsHistory[ri * nA + ai] ?? 0;
                              return (
                                <td key={t} className="py-2 pr-3 text-right mono text-primary">
                                  {(w * 100).toFixed(1)}%
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* G — Risk metrics table */}
            <Card>
              <p className="text-[13px] font-medium text-primary mb-4">Risk Metrics</p>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="hairline-b">
                    <th className="pb-2 text-left text-[11px] uppercase tracking-[0.05em] text-tertiary">
                      Metric
                    </th>
                    <th className="pb-2 text-right text-[11px] uppercase tracking-[0.05em] text-tertiary">
                      Strategy
                    </th>
                    {ewMetrics && (
                      <th className="pb-2 text-right text-[11px] uppercase tracking-[0.05em] text-tertiary">
                        Equal Weight
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="text-[12px]">
                  {[
                    { label: 'CAGR',           strat: fmtPct(portfolioMetrics?.cagr),   ew: fmtPct(ewMetrics?.cagr) },
                    { label: 'Ann. Volatility', strat: portfolioMetrics ? `${(portfolioMetrics.annVol * 100).toFixed(2)}%` : '—', ew: ewMetrics ? `${(ewMetrics.annVol * 100).toFixed(2)}%` : '—' },
                    { label: 'Max Drawdown',    strat: portfolioMetrics ? `${(portfolioMetrics.maxDd  * 100).toFixed(2)}%` : '—', ew: ewMetrics ? `${(ewMetrics.maxDd  * 100).toFixed(2)}%` : '—' },
                    { label: 'Sharpe Ratio',    strat: fmtNum(portfolioMetrics?.sharpe), ew: fmtNum(ewMetrics?.sharpe) },
                    { label: 'Calmar Ratio',    strat: fmtNum(portfolioMetrics?.calmar), ew: fmtNum(ewMetrics?.calmar) },
                    { label: 'Sortino Ratio',   strat: fmtNum(portfolioMetrics?.sortino), ew: '—' },
                  ].map(({ label, strat, ew }) => (
                    <tr key={label} className="hairline-b last:border-0 hover:bg-[var(--bg-hover)]">
                      <td className="py-2 text-secondary">{label}</td>
                      <td className="py-2 text-right mono text-primary">{strat}</td>
                      {ewMetrics && <td className="py-2 text-right mono text-tertiary">{ew}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            {/* ── Section H — Rebalancing flows ─────────────────────────── */}
            {sankeyData && (
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-[13px] font-medium text-primary">Rebalancing Flows</p>
                  <span className="mono text-[11px] text-tertiary">
                    {sankeyData.fromDate} → {sankeyData.toDate}
                  </span>
                </div>

                {/* Transition slider */}
                <div className="mb-5">
                  <Slider
                    label={`Transition ${sankeyIdx + 1} of ${sankeyData.maxIdx + 1}`}
                    value={sankeyIdx}
                    min={0}
                    max={sankeyData.maxIdx}
                    step={1}
                    format={(v) => `${Math.round(v) + 1} / ${sankeyData.maxIdx + 1}`}
                    onChange={(v) => setSankeyIdx(Math.round(v))}
                  />
                </div>

                <SankeyFlow
                  beforeWeights={sankeyData.before}
                  afterWeights={sankeyData.after}
                  tickers={tickers.slice(0, sankeyData.before.length)}
                  beforeDate={sankeyData.fromDate}
                  afterDate={sankeyData.toDate}
                  height={380}
                />
              </Card>
            )}

            {/* ── Section I — Bootstrap Sharpe significance ──────────────── */}
            <Card>
              <div className="flex items-center justify-between mb-4">
                <p className="text-[13px] font-medium text-primary">
                  Bootstrap Sharpe Significance
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={runBootstrap}
                  disabled={bootLoading || !result?.portfolioReturns}
                  loading={bootLoading}
                >
                  {bootLoading ? 'Computing…' : 'Compute CI'}
                </Button>
              </div>

              {!bootResult && !bootLoading && (
                <p className="text-[13px] text-tertiary">
                  Run bootstrap to estimate Sharpe confidence interval
                  (n=2000, block=21 periods).
                </p>
              )}

              {bootError && (
                <p className="text-[12px] text-loss">{bootError}</p>
              )}

              {bootResult && (
                <>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <MetricCard
                      label="Mean Sharpe"
                      value={fmtNum(bootResult.mean)}
                      variant="accent"
                    />
                    <MetricCard
                      label="Lower 95% CI"
                      value={fmtNum(bootResult.ciLower)}
                      variant={bootResult.ciLower != null && bootResult.ciLower > 0 ? 'gain' : 'default'}
                    />
                    <MetricCard
                      label="Upper 95% CI"
                      value={fmtNum(bootResult.ciUpper)}
                    />
                  </div>

                  {/* Verdict */}
                  <div className={[
                    'mb-5 rounded-md px-4 py-2.5 text-[13px] border',
                    bootResult.ciLower != null && bootResult.ciLower > 0
                      ? 'border-gain/20 bg-gain/5 text-gain'
                      : 'border-[var(--border)] text-tertiary',
                  ].join(' ')}>
                    {bootResult.ciLower != null && bootResult.ciLower > 0
                      ? 'Statistically significant positive Sharpe (lower 95% CI > 0)'
                      : 'Sharpe not statistically different from zero at 95% confidence'}
                  </div>

                  {/* Histogram (normal approximation) */}
                  {bootSamples.length > 0 && (
                    <>
                      <p className="text-[11px] text-tertiary mb-2">
                        Approximate Sharpe distribution (normal fit from CI bounds)
                      </p>
                      <Histogram
                        values={bootSamples}
                        nBins={40}
                        xLabel="Sharpe ratio"
                        markers={bootMarkers}
                        height={180}
                        barColor={C.accent}
                      />
                    </>
                  )}
                </>
              )}
            </Card>

            {/* ── Section J — Stress period analysis ────────────────────── */}
            {stressData.length > 0 && (
              <Card>
                <p className="text-[13px] font-medium text-primary mb-4">
                  Stress Period Analysis
                </p>

                <GroupedBarChart data={stressChartData} height={220} />

                {/* Detail table */}
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="hairline-b">
                        <th className="pb-2 text-left text-[11px] uppercase tracking-[0.05em] text-tertiary">
                          Period
                        </th>
                        <th className="pb-2 text-left text-[11px] uppercase tracking-[0.05em] text-tertiary">
                          Series
                        </th>
                        <th className="pb-2 text-right text-[11px] uppercase tracking-[0.05em] text-tertiary">
                          Cum. Return
                        </th>
                        <th className="pb-2 text-right text-[11px] uppercase tracking-[0.05em] text-tertiary">
                          Max DD
                        </th>
                        <th className="pb-2 text-right text-[11px] uppercase tracking-[0.05em] text-tertiary">
                          Recovery
                        </th>
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
                                <div className="text-[11px] text-tertiary mono">
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
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
