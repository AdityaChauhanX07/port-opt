'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import * as d3 from 'd3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FrontierPoint {
  risk: number;
  return: number;
  sharpe: number;
  weights: number[];
}

export interface AssetStat {
  ticker: string;
  vol: number;
  ret: number;
}

export interface AlgorithmMarker {
  algorithm: 'hrp' | 'risk_parity' | 'cvar' | 'robust';
  vol: number;
  ret: number;
  sharpe: number;
}

export interface HoverMetrics {
  vol: number;
  ret: number;
  sharpe: number;
}

export interface EfficientFrontierProps {
  points: FrontierPoint[];
  bestIdx?: number | null;
  tickers: string[];
  rf?: number;
  assetStats?: AssetStat[];
  algorithmMarkers?: AlgorithmMarker[];
  visibleAlgorithms?: Set<string>;
  selectedIdx?: number | null;
  onPointHover?: (
    index: number | null,
    weights: Float64Array | null,
    metrics: HoverMetrics | null,
  ) => void;
  onPointSelect?: (index: number | null) => void;
  onToggleAlgorithm?: (name: string) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const M = { top: 24, right: 32, bottom: 52, left: 64 };
const HEATMAP_H = 80;
const HEATMAP_LABEL_W = 44;

const ALGO_LABELS: Record<string, string> = {
  hrp: 'HRP',
  risk_parity: 'Risk Parity',
  cvar: 'CVaR',
  robust: 'Robust',
};

const ALGO_COLORS: Record<string, string> = {
  hrp: '#3fb950',
  risk_parity: '#8b949e',
  cvar: '#8b5cf6',
  robust: '#f59e0b',
};

// ---------------------------------------------------------------------------
// SVG marker path helpers
// ---------------------------------------------------------------------------

function squarePath(cx: number, cy: number, r: number) {
  return `M${cx - r},${cy - r}h${r * 2}v${r * 2}h${-r * 2}Z`;
}

function trianglePath(cx: number, cy: number, r: number) {
  const h = r * 1.73;
  return `M${cx},${cy - h * 0.67}L${cx + r},${cy + h * 0.33}L${cx - r},${cy + h * 0.33}Z`;
}

function diamondPath(cx: number, cy: number, r: number) {
  return `M${cx},${cy - r}L${cx + r},${cy}L${cx},${cy + r}L${cx - r},${cy}Z`;
}

function crossPath(cx: number, cy: number, r: number) {
  return [
    `M${cx - r},${cy}H${cx + r}`,
    `M${cx},${cy - r}V${cy + r}`,
  ].join(' ');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EfficientFrontier({
  points,
  bestIdx,
  tickers,
  rf = 0,
  assetStats,
  algorithmMarkers = [],
  visibleAlgorithms = new Set(),
  selectedIdx,
  onPointHover,
  onPointSelect,
  onToggleAlgorithm,
}: EfficientFrontierProps) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const svgRef        = useRef<SVGSVGElement>(null);
  const heatmapRef    = useRef<SVGSVGElement>(null);
  const xScaleRef     = useRef<d3.ScaleLinear<number, number> | null>(null);
  const yScaleRef     = useRef<d3.ScaleLinear<number, number> | null>(null);
  const rafRef        = useRef<number | null>(null);

  const [dims, setDims]               = useState({ width: 600, height: 380 });
  const [cursor, setCursor]           = useState<{ svgX: number; svgY: number; idx: number } | null>(null);
  const [lockedIdx, setLockedIdx]     = useState<number | null>(null);
  const [algoTooltip, setAlgoTooltip] = useState<{ x: number; y: number; label: string; vol: number; ret: number; sharpe: number } | null>(null);

  // ── ResizeObserver ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        setDims({ width: Math.max(width, 240), height: Math.max(height, 200) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── D3 static draw ────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    if (!svgRef.current) return;

    const { width, height } = dims;
    const iW = width - M.left - M.right;
    const iH = height - M.top - M.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Empty state
    if (points.length === 0) {
      svg
        .append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#525252')
        .attr('font-size', 13)
        .text('Run an optimisation to see the frontier');
      return;
    }

    const g = svg.append('g').attr('transform', `translate(${M.left},${M.top})`);

    // ── Scales ────────────────────────────────────────────────────────────
    const allVols = [
      ...points.map((p) => p.risk * 100),
      ...(assetStats ?? []).map((a) => a.vol * 100),
      ...algorithmMarkers.filter((m) => visibleAlgorithms.has(m.algorithm)).map((m) => m.vol * 100),
    ];
    const allRets = [
      ...points.map((p) => p.return * 100),
      ...(assetStats ?? []).map((a) => a.ret * 100),
      ...algorithmMarkers.filter((m) => visibleAlgorithms.has(m.algorithm)).map((m) => m.ret * 100),
      rf * 100,
    ];

    const [rxMin = 0, rxMax = 1] = d3.extent(allVols) as [number, number];
    const [ryMin = 0, ryMax = 1] = d3.extent(allRets) as [number, number];
    const xPad = Math.max((rxMax - rxMin) * 0.12, 0.5);
    const yPad = Math.max((ryMax - ryMin) * 0.12, 0.5);

    const x = d3.scaleLinear().domain([rxMin - xPad, rxMax + xPad]).range([0, iW]);
    const y = d3.scaleLinear().domain([ryMin - yPad, ryMax + yPad]).range([iH, 0]);
    xScaleRef.current = x;
    yScaleRef.current = y;

    // ── Gridlines ────────────────────────────────────────────────────────
    g.append('g').selectAll('line')
      .data(x.ticks(6)).join('line')
      .attr('x1', (d) => x(d)).attr('x2', (d) => x(d))
      .attr('y1', 0).attr('y2', iH)
      .attr('stroke', 'rgba(255,255,255,0.04)').attr('stroke-width', 1);

    g.append('g').selectAll('line')
      .data(y.ticks(6)).join('line')
      .attr('x1', 0).attr('x2', iW)
      .attr('y1', (d) => y(d)).attr('y2', (d) => y(d))
      .attr('stroke', 'rgba(255,255,255,0.04)').attr('stroke-width', 1);

    // ── Axes ─────────────────────────────────────────────────────────────
    const styleAxis = (sel: d3.Selection<SVGGElement, unknown, null, undefined>) => {
      sel.select('.domain').attr('stroke', 'rgba(255,255,255,0.08)');
      sel.selectAll('.tick line').attr('stroke', 'rgba(255,255,255,0.08)');
      sel.selectAll<SVGTextElement, unknown>('.tick text')
        .attr('fill', '#6b6b6b').attr('font-size', 11);
    };

    g.append('g')
      .attr('transform', `translate(0,${iH})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat((d) => `${+d}%`))
      .call(styleAxis);

    g.append('g')
      .call(d3.axisLeft(y).ticks(6).tickFormat((d) => `${+d}%`))
      .call(styleAxis);

    g.append('text')
      .attr('x', iW / 2).attr('y', iH + 44)
      .attr('text-anchor', 'middle')
      .attr('fill', '#6b6b6b').attr('font-size', 11)
      .text('Annual Volatility (%)');

    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -iH / 2).attr('y', -50)
      .attr('text-anchor', 'middle')
      .attr('fill', '#6b6b6b').attr('font-size', 11)
      .text('Annual Return (%)');

    // ── Capital Market Line ───────────────────────────────────────────────
    if (bestIdx != null && points[bestIdx] && points.length > 1) {
      const bp = points[bestIdx];
      const rfPct = rf * 100;
      const slope = (bp.return * 100 - rfPct) / (bp.risk * 100);
      const xEnd  = x.domain()[1];
      const yEnd  = rfPct + slope * xEnd;

      g.append('line')
        .attr('x1', x(0)).attr('y1', y(rfPct))
        .attr('x2', x(xEnd)).attr('y2', y(yEnd))
        .attr('stroke', 'rgba(255,255,255,0.08)')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4,4')
        .attr('pointer-events', 'none');
    }

    // ── Individual asset diamonds ─────────────────────────────────────────
    if (assetStats && assetStats.length > 0) {
      const assetG = g.append('g').attr('class', 'assets');
      assetStats.forEach((a) => {
        const ax = x(a.vol * 100);
        const ay = y(a.ret * 100);
        assetG.append('path')
          .attr('d', diamondPath(ax, ay, 4))
          .attr('fill', '#2a2a2a')
          .attr('stroke', '#4a4a4a')
          .attr('stroke-width', 0.5)
          .attr('pointer-events', 'none');
        assetG.append('text')
          .attr('x', ax + 7)
          .attr('y', ay + 3.5)
          .attr('fill', '#6b6b6b')
          .attr('font-size', 10)
          .text(a.ticker);
      });
    }

    // ── Frontier line ─────────────────────────────────────────────────────
    if (points.length > 1) {
      const lineFn = d3.line<FrontierPoint>()
        .x((p) => x(p.risk   * 100))
        .y((p) => y(p.return * 100))
        .curve(d3.curveMonotoneX);

      const path = g.append('path')
        .datum(points)
        .attr('fill', 'none')
        .attr('stroke', '#737373')
        .attr('stroke-width', 1.5)
        .attr('opacity', 0.6)
        .attr('d', lineFn)
        .attr('pointer-events', 'none');

      const len = (path.node() as SVGPathElement | null)?.getTotalLength() ?? 0;
      path
        .attr('stroke-dasharray', `${len} ${len}`)
        .attr('stroke-dashoffset', len)
        .transition().duration(800).ease(d3.easeCubicOut)
        .attr('stroke-dashoffset', 0);
    }

    // ── Frontier dots ─────────────────────────────────────────────────────
    g.selectAll<SVGCircleElement, FrontierPoint>('circle.dot')
      .data(points).join('circle')
      .attr('class', 'dot')
      .attr('cx', (p) => x(p.risk   * 100))
      .attr('cy', (p) => y(p.return * 100))
      .attr('r', 2.5)
      .attr('fill', '#737373')
      .attr('stroke', 'none')
      .attr('pointer-events', 'none');

    // ── Max Sharpe halo ───────────────────────────────────────────────────
    if (bestIdx != null && points[bestIdx]) {
      const bp = points[bestIdx];
      const bx = x(bp.risk   * 100);
      const by = y(bp.return * 100);

      g.append('circle')
        .attr('cx', bx).attr('cy', by).attr('r', 6)
        .attr('fill', '#5e8eff')
        .attr('stroke', '#0a0a0a')
        .attr('stroke-width', 1.5)
        .attr('pointer-events', 'none')
        .attr('opacity', 0)
        .transition().delay(800).duration(300)
        .attr('opacity', 1);
    }

    // ── Algorithm overlay markers ─────────────────────────────────────────
    algorithmMarkers.forEach((m) => {
      if (!visibleAlgorithms.has(m.algorithm)) return;
      const mx = x(m.vol * 100);
      const my = y(m.ret * 100);
      const color = ALGO_COLORS[m.algorithm] ?? '#888';
      const r = 5;
      let pathD: string;
      let isCross = false;

      if (m.algorithm === 'hrp')          pathD = squarePath(mx, my, r);
      else if (m.algorithm === 'risk_parity') pathD = trianglePath(mx, my, r);
      else if (m.algorithm === 'cvar')    pathD = diamondPath(mx, my, r);
      else { pathD = crossPath(mx, my, r); isCross = true; }

      if (isCross) {
        g.append('path')
          .attr('d', pathD)
          .attr('fill', 'none')
          .attr('stroke', color)
          .attr('stroke-width', 2.5)
          .attr('stroke-linecap', 'round')
          .attr('pointer-events', 'none');
      } else {
        g.append('path')
          .attr('d', pathD)
          .attr('fill', color)
          .attr('stroke', '#0a0a0a')
          .attr('stroke-width', 1)
          .attr('pointer-events', 'none');
      }
    });
  }, [points, dims, bestIdx, rf, assetStats, algorithmMarkers, visibleAlgorithms]);

  useEffect(() => { draw(); }, [draw]);

  // ── Heatmap draw ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!heatmapRef.current || points.length === 0 || tickers.length === 0) return;

    const nPoints = points.length;
    const nAssets = tickers.length;
    const svgW = dims.width;
    const innerW = svgW - M.left - M.right;
    const cellW = innerW / nPoints;
    const cellH = (HEATMAP_H - 20) / nAssets;

    const maxW = points.reduce((mx, p) =>
      Math.max(mx, ...p.weights.map(Math.abs)), 0.001
    );

    const svg = d3.select(heatmapRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g').attr('transform', `translate(${M.left},10)`);

    // Ticker labels
    tickers.forEach((t, i) => {
      g.append('text')
        .attr('x', -4)
        .attr('y', i * cellH + cellH / 2 + 3.5)
        .attr('text-anchor', 'end')
        .attr('fill', '#6b6b6b')
        .attr('font-size', 9.5)
        .attr('font-family', 'var(--font-mono, monospace)')
        .text(t);
    });

    // Cells
    points.forEach((p, pi) => {
      p.weights.forEach((w, ai) => {
        if (ai >= nAssets) return;
        const opacity = Math.abs(w) / maxW;
        g.append('rect')
          .attr('x', pi * cellW + 0.5)
          .attr('y', ai * cellH + 0.5)
          .attr('width', cellW - 1)
          .attr('height', cellH - 1)
          .attr('rx', 1)
          .attr('fill', `rgba(94,142,255,${(opacity * 0.85).toFixed(3)})`)
          .attr('cursor', 'pointer')
          .on('click', () => onPointSelect?.(pi));
      });
    });

    // Highlight locked or cursor column
    const highlightIdx = lockedIdx ?? cursor?.idx ?? null;
    if (highlightIdx != null) {
      g.append('rect')
        .attr('x', highlightIdx * cellW)
        .attr('y', 0)
        .attr('width', cellW)
        .attr('height', nAssets * cellH)
        .attr('fill', 'none')
        .attr('stroke', '#5e8eff')
        .attr('stroke-width', 1)
        .attr('rx', 1)
        .attr('pointer-events', 'none');
    }
  }, [points, tickers, dims, lockedIdx, cursor, onPointSelect]);

  // ── Pointer events (RAF-throttled) ────────────────────────────────────────
  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const ox = e.nativeEvent.offsetX;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const xs = xScaleRef.current;
      const ys = yScaleRef.current;
      if (!xs || !ys || points.length === 0) return;

      // ox is relative to the hit div which starts at x=M.left inside the SVG
      const riskPct = xs.invert(ox);
      let nearestIdx = 0;
      let minDist = Infinity;
      for (let i = 0; i < points.length; i++) {
        const dist = Math.abs(points[i].risk * 100 - riskPct);
        if (dist < minDist) { minDist = dist; nearestIdx = i; }
      }

      const p = points[nearestIdx];
      const svgX = xs(p.risk   * 100) + M.left;
      const svgY = ys(p.return * 100) + M.top;
      setCursor({ svgX, svgY, idx: nearestIdx });

      if (lockedIdx === null) {
        const weights = new Float64Array(p.weights);
        onPointHover?.(nearestIdx, weights, { vol: p.risk, ret: p.return, sharpe: p.sharpe });
      }
    });
  }, [points, lockedIdx, onPointHover]);

  const handlePointerLeave = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (lockedIdx === null) {
      setCursor(null);
      onPointHover?.(null, null, null);
    }
  }, [lockedIdx, onPointHover]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const ox = e.nativeEvent.offsetX;
    const xs = xScaleRef.current;
    if (!xs || points.length === 0) return;

    const riskPct = xs.invert(ox);
    let nearestIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(points[i].risk * 100 - riskPct);
      if (dist < minDist) { minDist = dist; nearestIdx = i; }
    }

    if (lockedIdx === nearestIdx) {
      // Unlock
      setLockedIdx(null);
      onPointSelect?.(null);
    } else {
      setLockedIdx(nearestIdx);
      onPointSelect?.(nearestIdx);
    }
  }, [points, lockedIdx, onPointSelect]);

  // ── When locked, ensure cursor stays visible ──────────────────────────────
  useEffect(() => {
    if (lockedIdx == null || !xScaleRef.current || !yScaleRef.current || points.length === 0) return;
    const p = points[lockedIdx];
    if (!p) return;
    const svgX = xScaleRef.current(p.risk   * 100) + M.left;
    const svgY = yScaleRef.current(p.return * 100) + M.top;
    setCursor({ svgX, svgY, idx: lockedIdx });
    onPointHover?.(lockedIdx, new Float64Array(p.weights), { vol: p.risk, ret: p.return, sharpe: p.sharpe });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedIdx]);

  // ── Reset locked idx when points change ───────────────────────────────────
  useEffect(() => {
    setLockedIdx(null);
    setCursor(null);
  }, [points]);

  const iW = dims.width  - M.left - M.right;
  const iH = dims.height - M.top  - M.bottom;
  const activeCursor = lockedIdx != null ? cursor : cursor;

  const algos: Array<{ key: string; label: string; color: string }> = [
    { key: 'hrp',          label: 'HRP',         color: ALGO_COLORS.hrp },
    { key: 'risk_parity',  label: 'Risk Parity',  color: ALGO_COLORS.risk_parity },
    { key: 'cvar',         label: 'CVaR',         color: ALGO_COLORS.cvar },
    { key: 'robust',       label: 'Robust',       color: ALGO_COLORS.robust },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col gap-2"
    >
      {/* Algorithm toggle chips */}
      {onToggleAlgorithm && (
        <div className="flex items-center gap-3 pl-1">
          {algos.map(({ key, label, color }) => {
            const active = visibleAlgorithms.has(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => onToggleAlgorithm(key)}
                className="flex items-center gap-1.5 text-[11px] transition-opacity"
                style={{ opacity: active ? 1 : 0.4 }}
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ backgroundColor: active ? color : '#444' }}
                />
                <span style={{ color: active ? '#a3a3a3' : '#525252' }}>{label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Main chart area */}
      <div
        ref={containerRef}
        className="relative w-full"
        style={{ height: dims.height, minHeight: 280 }}
      >
        {/* D3 static layer */}
        <svg
          ref={svgRef}
          width={dims.width}
          height={dims.height}
          className="absolute inset-0 overflow-visible"
        />

        {/* React cursor overlay */}
        {activeCursor && points.length > 0 && (
          <svg
            width={dims.width}
            height={dims.height}
            className="absolute inset-0 pointer-events-none overflow-visible"
          >
            {/* Vertical line to x-axis */}
            <line
              x1={activeCursor.svgX} y1={M.top}
              x2={activeCursor.svgX} y2={dims.height - M.bottom}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={1}
              strokeDasharray="3,3"
            />
            {/* Horizontal line to y-axis */}
            <line
              x1={M.left}            y1={activeCursor.svgY}
              x2={activeCursor.svgX} y2={activeCursor.svgY}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={1}
              strokeDasharray="3,3"
            />
            {/* Highlighted point */}
            <circle
              cx={activeCursor.svgX}
              cy={activeCursor.svgY}
              r={5}
              fill="#5e8eff"
            />
            {/* Lock ring */}
            {lockedIdx != null && (
              <circle
                cx={activeCursor.svgX}
                cy={activeCursor.svgY}
                r={8}
                fill="none"
                stroke="#5e8eff"
                strokeWidth={1}
                strokeOpacity={0.5}
              />
            )}
          </svg>
        )}

        {/* Algorithm marker tooltips */}
        {algoTooltip && (
          <div
            className="absolute z-20 pointer-events-none rounded border border-[rgba(255,255,255,0.1)] bg-[#111] px-2.5 py-2 text-[11px]"
            style={{ left: algoTooltip.x + 12, top: algoTooltip.y - 8 }}
          >
            <p className="mb-1 font-semibold text-[#e5e5e5]">{algoTooltip.label}</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[#666]">
              <span>Return</span><span className="text-[#3fb950]">{(algoTooltip.ret * 100).toFixed(2)}%</span>
              <span>Vol</span><span className="text-[#e5e5e5]">{(algoTooltip.vol * 100).toFixed(2)}%</span>
              <span>Sharpe</span><span className="text-[#5e8eff]">{algoTooltip.sharpe.toFixed(3)}</span>
            </div>
          </div>
        )}

        {/* Event capture overlay (inner chart area only) */}
        {points.length > 0 && (
          <div
            className="absolute"
            style={{ left: M.left, top: M.top, width: iW, height: iH, cursor: 'crosshair' }}
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
            onClick={handleClick}
          />
        )}

        {/* Algorithm marker hit areas */}
        {algorithmMarkers.map((m) => {
          if (!visibleAlgorithms.has(m.algorithm) || !xScaleRef.current || !yScaleRef.current) return null;
          const ax = xScaleRef.current(m.vol * 100) + M.left;
          const ay = yScaleRef.current(m.ret * 100) + M.top;
          return (
            <div
              key={m.algorithm}
              className="absolute w-5 h-5 cursor-default"
              style={{ left: ax - 10, top: ay - 10 }}
              onPointerEnter={(e) => {
                const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                setAlgoTooltip({
                  x: e.clientX - rect.left,
                  y: e.clientY - rect.top,
                  label: ALGO_LABELS[m.algorithm] ?? m.algorithm,
                  vol: m.vol, ret: m.ret, sharpe: m.sharpe,
                });
              }}
              onPointerLeave={() => setAlgoTooltip(null)}
            />
          );
        })}
      </div>

      {/* Weight heatmap strip */}
      {points.length > 0 && tickers.length > 0 && (
        <div className="relative">
          <svg
            ref={heatmapRef}
            width={dims.width}
            height={HEATMAP_H}
            className="overflow-visible"
          />
        </div>
      )}
    </motion.div>
  );
}
