'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

// ---------------------------------------------------------------------------
// Types (public API unchanged)
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
  height?: number;
  onPointHover?: (index: number | null, weights: Float64Array | null, metrics: HoverMetrics | null) => void;
  onPointSelect?: (index: number | null) => void;
  onToggleAlgorithm?: (name: string) => void;
  /** True for single-portfolio algorithms (HRP, ERC, CVaR, Robust) */
  pointMode?: boolean;
  /** Label shown next to the optimal dot, e.g. "HRP optimal" */
  pointModeLabel?: string;
}

// ---------------------------------------------------------------------------
// Constants — use raw token values since D3 can't resolve CSS vars
// ---------------------------------------------------------------------------

const M = { top: 16, right: 16, bottom: 36, left: 52 };
const HEATMAP_H = 80;

// Use CSS custom properties so the chart responds to theme changes automatically.
// SVG presentation attributes resolve CSS vars at paint time in modern browsers.
const C = {
  borderSubtle: 'var(--border-subtle)',
  border:       'var(--border)',
  borderStrong: 'var(--border-strong)',
  textTertiary: 'var(--text-tertiary)',
  textSecondary:'var(--text-secondary)',
  accent:       'var(--accent)',
  accentPurple: '#8B5CF6',   // no token; kept as fixed purple
  bg:           'var(--bg)',
  surface:      'var(--surface)',
} as const;

const ALGO_META: Record<string, { label: string; color: string }> = {
  hrp:          { label: 'HRP',         color: '#10B981' },
  risk_parity:  { label: 'Risk Parity', color: '#A1A1A8' },
  cvar:         { label: 'CVaR',        color: '#8B5CF6' },
  robust:       { label: 'Robust',      color: '#F59E0B' },
};

// ---------------------------------------------------------------------------
// Shape helpers
// ---------------------------------------------------------------------------

const sq  = (cx: number, cy: number, r: number) => `M${cx-r},${cy-r}h${r*2}v${r*2}h${-r*2}Z`;
const tri = (cx: number, cy: number, r: number) => { const h = r*1.73; return `M${cx},${cy-h*.67}L${cx+r},${cy+h*.33}L${cx-r},${cy+h*.33}Z`; };
const dia = (cx: number, cy: number, r: number) => `M${cx},${cy-r}L${cx+r},${cy}L${cx},${cy+r}L${cx-r},${cy}Z`;

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
  height: chartH = 480,
  onPointHover,
  onPointSelect,
  onToggleAlgorithm,
  pointMode = false,
  pointModeLabel = '',
}: EfficientFrontierProps) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const svgRef        = useRef<SVGSVGElement>(null);
  const heatmapRef    = useRef<SVGSVGElement>(null);
  const xScaleRef     = useRef<d3.ScaleLinear<number,number> | null>(null);
  const yScaleRef     = useRef<d3.ScaleLinear<number,number> | null>(null);
  const rafRef        = useRef<number | null>(null);

  const [width,      setWidth]      = useState(600);
  const [cursor,     setCursor]     = useState<{ svgX: number; svgY: number; idx: number } | null>(null);
  const [lockedIdx,  setLockedIdx]  = useState<number | null>(null);
  const [algoTip,    setAlgoTip]    = useState<{ x: number; y: number; m: AlgorithmMarker } | null>(null);

  // ── ResizeObserver (width only) ───────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = e.contentRect.width;
        if (w > 0) setWidth(Math.max(w, 240));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── D3 static draw ────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    if (!svgRef.current) return;

    const iW = width - M.left - M.right;
    const iH = chartH - M.top - M.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // ── Empty state: no data loaded at all ───────────────────────────────────
    if (points.length === 0 && (!assetStats || assetStats.length === 0)) {
      const cx = width / 2;
      const cy = chartH / 2;
      svg.append('text')
        .attr('x', cx).attr('y', cy - 40)
        .attr('text-anchor', 'middle')
        .attr('fill', C.textTertiary)
        .attr('font-size', 10)
        .attr('font-weight', 600)
        .attr('letter-spacing', '0.1em')
        .attr('font-family', 'var(--font-mono, monospace)')
        .text('NO DATA LOADED');
      svg.append('text')
        .attr('x', cx).attr('y', cy - 8)
        .attr('text-anchor', 'middle')
        .attr('fill', C.textSecondary)
        .attr('font-size', 18)
        .attr('font-family', 'var(--font-serif, Georgia, serif)')
        .text('Load price data to begin');
      svg.append('text')
        .attr('x', cx).attr('y', cy + 22)
        .attr('text-anchor', 'middle')
        .attr('fill', C.textTertiary)
        .attr('font-size', 12)
        .attr('font-family', 'var(--font-sans, system-ui)')
        .text('Pick an asset universe and date range, then click Load Data.');
      return;
    }

    // ── Scales ──────────────────────────────────────────────────────────────
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
    const yPad = Math.max((ryMax - ryMin) * 0.15, 0.5);

    const x = d3.scaleLinear().domain([rxMin - xPad, rxMax + xPad]).range([0, iW]);
    const y = d3.scaleLinear().domain([ryMin - yPad, ryMax + yPad]).range([iH, 0]);
    xScaleRef.current = x;
    yScaleRef.current = y;

    // ── Gradient + glow filter defs ─────────────────────────────────────────
    const defs = svg.append('defs');
    const grad = defs.append('linearGradient')
      .attr('id', 'ef-line-grad')
      .attr('gradientUnits', 'userSpaceOnUse')
      .attr('x1', M.left + x(rxMin - xPad))
      .attr('y1', 0)
      .attr('x2', M.left + x(rxMax + xPad))
      .attr('y2', 0);
    grad.append('stop').attr('offset', '0%').attr('stop-color', C.accent);
    grad.append('stop').attr('offset', '100%').attr('stop-color', C.accentPurple);

    // Glow filter used for point-mode optimal dot
    const glowFilter = defs.append('filter')
      .attr('id', 'ef-opt-glow')
      .attr('x', '-80%').attr('y', '-80%')
      .attr('width', '260%').attr('height', '260%');
    glowFilter.append('feGaussianBlur').attr('stdDeviation', '5').attr('result', 'blur');
    const feMerge = glowFilter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'blur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    const g = svg.append('g').attr('transform', `translate(${M.left},${M.top})`);

    // ── Horizontal grid only ─────────────────────────────────────────────────
    g.append('g').selectAll('line')
      .data(y.ticks(6)).join('line')
      .attr('x1', 0).attr('x2', iW)
      .attr('y1', (d) => y(d)).attr('y2', (d) => y(d))
      .attr('stroke', C.borderSubtle).attr('stroke-width', 1);

    // ── Axes ─────────────────────────────────────────────────────────────────
    const styleAxis = (sel: d3.Selection<SVGGElement, unknown, null, undefined>) => {
      sel.select('.domain').attr('stroke', C.border);
      sel.selectAll('.tick line').attr('stroke', C.border);
      sel.selectAll<SVGTextElement, unknown>('.tick text')
        .attr('fill', C.textTertiary)
        .attr('font-size', 11)
        .attr('font-family', 'var(--font-mono, monospace)');
    };

    g.append('g')
      .attr('transform', `translate(0,${iH})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat((d) => `${+d}%`))
      .call(styleAxis);

    g.append('g')
      .call(d3.axisLeft(y).ticks(6).tickFormat((d) => `${+d}%`))
      .call(styleAxis);

    // ── Capital Market Line ───────────────────────────────────────────────────
    if (!pointMode && bestIdx != null && points[bestIdx] && points.length > 1) {
      const bp = points[bestIdx]!;
      const rfPct = rf * 100;
      const slope = (bp.return * 100 - rfPct) / (bp.risk * 100 || 1);
      const xEnd  = (x.domain()[1] ?? rxMax + xPad);
      const yEnd  = rfPct + slope * xEnd;
      g.append('line')
        .attr('x1', x(0)).attr('y1', y(rfPct))
        .attr('x2', x(xEnd)).attr('y2', y(yEnd))
        .attr('stroke', C.textTertiary)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4,4')
        .attr('pointer-events', 'none');
    }

    // ── Asset diamonds — 50% opacity when no results yet ─────────────────────
    const assetOpacity = points.length === 0 ? 0.5 : 1;
    if (assetStats && assetStats.length > 0) {
      assetStats.forEach((a) => {
        g.append('path')
          .attr('d', dia(x(a.vol * 100), y(a.ret * 100), 4))
          .attr('fill', C.surface)
          .attr('stroke', C.textSecondary)
          .attr('stroke-width', 1.5)
          .attr('opacity', assetOpacity)
          .attr('pointer-events', 'none');
      });
    }

    // ── State 2: data loaded, no optimization yet ─────────────────────────────
    if (points.length === 0) {
      g.append('text')
        .attr('x', iW / 2).attr('y', iH / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#A1A1A8')
        .attr('font-size', 14)
        .attr('font-family', 'var(--font-sans, system-ui)')
        .text('Click Optimize to compute');
      return;
    }

    // ── Frontier line (gradient) — frontier mode only ─────────────────────────
    if (!pointMode && points.length > 1) {
      const lineFn = d3.line<FrontierPoint>()
        .x((p) => x(p.risk   * 100))
        .y((p) => y(p.return * 100))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(points)
        .attr('fill', 'none')
        .attr('stroke', 'url(#ef-line-grad)')
        .attr('stroke-width', 2)
        .attr('d', lineFn)
        .attr('pointer-events', 'none');
    }

    // ── Frontier dots — frontier mode only ───────────────────────────────────
    if (!pointMode) {
      g.selectAll<SVGCircleElement, FrontierPoint>('circle.dot')
        .data(points).join('circle')
        .attr('class', 'dot')
        .attr('cx', (p) => x(p.risk   * 100))
        .attr('cy', (p) => y(p.return * 100))
        .attr('r', 3)
        .attr('fill', C.textSecondary)
        .attr('pointer-events', 'none');
    }

    // ── Max Sharpe halo — frontier mode only ─────────────────────────────────
    if (!pointMode && bestIdx != null && points[bestIdx]) {
      const bp = points[bestIdx]!;
      const bx = x(bp.risk   * 100);
      const by = y(bp.return * 100);
      g.append('circle')
        .attr('cx', bx).attr('cy', by).attr('r', 12)
        .attr('fill', 'none')
        .attr('stroke', C.accent)
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.3)
        .attr('pointer-events', 'none');
      g.append('circle')
        .attr('cx', bx).attr('cy', by).attr('r', 6)
        .attr('fill', C.accent)
        .attr('stroke', C.bg)
        .attr('stroke-width', 2)
        .attr('pointer-events', 'none');
    }

    // ── Algorithm overlay markers — frontier mode only ────────────────────────
    if (!pointMode) {
      algorithmMarkers.forEach((m) => {
        if (!visibleAlgorithms.has(m.algorithm)) return;
        const mx   = x(m.vol * 100);
        const my   = y(m.ret * 100);
        const meta = ALGO_META[m.algorithm];
        const color = meta?.color ?? C.textSecondary;
        const r = 5;
        let pathD: string;
        if      (m.algorithm === 'hrp')         pathD = sq(mx, my, r);
        else if (m.algorithm === 'risk_parity') pathD = tri(mx, my, r);
        else if (m.algorithm === 'cvar')        pathD = dia(mx, my, r);
        else                                    pathD = sq(mx, my, r);
        g.append('path')
          .attr('d', pathD)
          .attr('fill', color)
          .attr('stroke', C.bg)
          .attr('stroke-width', 1.5)
          .attr('pointer-events', 'none');
      });
    }

    // ── Point mode: dashed connectors + optimal portfolio dot ─────────────────
    if (pointMode && points.length === 1) {
      const opt = points[0]!;
      const ox = x(opt.risk * 100);
      const oy = y(opt.return * 100);

      // Dashed spoke lines from optimal point to each asset marker
      if (assetStats && assetStats.length > 0) {
        assetStats.forEach((a) => {
          g.append('line')
            .attr('x1', ox).attr('y1', oy)
            .attr('x2', x(a.vol * 100)).attr('y2', y(a.ret * 100))
            .attr('stroke', C.accent)
            .attr('stroke-width', 1)
            .attr('stroke-dasharray', '4,4')
            .attr('stroke-opacity', 0.15)
            .attr('pointer-events', 'none');
        });
      }

      // Glow halo behind the dot
      g.append('circle')
        .attr('cx', ox).attr('cy', oy).attr('r', 16)
        .attr('fill', C.accent)
        .attr('fill-opacity', 0.18)
        .attr('filter', 'url(#ef-opt-glow)')
        .attr('pointer-events', 'none');

      // Optimal portfolio dot (16px diameter = r 8)
      g.append('circle')
        .attr('cx', ox).attr('cy', oy).attr('r', 8)
        .attr('fill', C.accent)
        .attr('stroke', C.bg)
        .attr('stroke-width', 2.5)
        .attr('pointer-events', 'none');

      // Label beside the dot
      if (pointModeLabel) {
        g.append('text')
          .attr('x', ox + 14).attr('y', oy + 4)
          .attr('fill', C.accent)
          .attr('font-size', 12)
          .attr('font-family', 'var(--font-mono, monospace)')
          .attr('pointer-events', 'none')
          .text(pointModeLabel);
      }
    }
  }, [points, width, chartH, bestIdx, rf, assetStats, algorithmMarkers, visibleAlgorithms, pointMode, pointModeLabel]);

  useEffect(() => { draw(); }, [draw]);

  // ── Heatmap draw ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!heatmapRef.current || points.length === 0 || tickers.length === 0) return;
    const nPts    = points.length;
    const nAssets = tickers.length;
    const iW      = width - M.left - M.right;
    const cellW   = iW / nPts;
    const innerH  = HEATMAP_H - 20;
    const cellH   = innerH / nAssets;
    const maxW    = points.reduce((mx, p) => Math.max(mx, ...p.weights.map(Math.abs)), 0.001);
    const highlightIdx = lockedIdx ?? cursor?.idx ?? null;

    const svg = d3.select(heatmapRef.current);
    svg.selectAll('*').remove();
    const g = svg.append('g').attr('transform', `translate(${M.left},10)`);

    // Ticker labels
    tickers.forEach((t, i) => {
      g.append('text')
        .attr('x', -5)
        .attr('y', i * cellH + cellH / 2 + 3.5)
        .attr('text-anchor', 'end')
        .attr('fill', C.textTertiary)
        .attr('font-size', 10)
        .attr('font-family', 'var(--font-mono, monospace)')
        .text(t);
    });

    // Cells
    points.forEach((p, pi) => {
      p.weights.forEach((w, ai) => {
        if (ai >= nAssets) return;
        const opacity = Math.abs(w) / maxW;
        g.append('rect')
          .attr('x', pi * cellW + 0.5).attr('y', ai * cellH + 0.5)
          .attr('width', cellW - 1).attr('height', cellH - 1)
          .attr('rx', 1)
          .attr('fill', `rgba(59,130,246,${(opacity * 0.8).toFixed(3)})`)
          .attr('cursor', 'pointer')
          .on('click', () => onPointSelect?.(pi));
      });
    });

    // Column highlight
    if (highlightIdx != null) {
      g.append('rect')
        .attr('x', highlightIdx * cellW).attr('y', 0)
        .attr('width', cellW).attr('height', nAssets * cellH)
        .attr('fill', 'none')
        .attr('stroke', C.accent)
        .attr('stroke-width', 1)
        .attr('rx', 1)
        .attr('pointer-events', 'none');
    }
  }, [points, tickers, width, lockedIdx, cursor, onPointSelect]);

  // ── Pointer events (RAF-throttled) ────────────────────────────────────────
  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const ox = e.nativeEvent.offsetX;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const xs = xScaleRef.current;
      const ys = yScaleRef.current;
      if (!xs || !ys || points.length === 0) return;
      const riskPct = xs.invert(ox);
      let nearestIdx = 0;
      let minDist = Infinity;
      for (let i = 0; i < points.length; i++) {
        const dist = Math.abs(points[i]!.risk * 100 - riskPct);
        if (dist < minDist) { minDist = dist; nearestIdx = i; }
      }
      const p = points[nearestIdx]!;
      setCursor({
        svgX: xs(p.risk   * 100) + M.left,
        svgY: ys(p.return * 100) + M.top,
        idx: nearestIdx,
      });
      if (lockedIdx === null) {
        onPointHover?.(nearestIdx, new Float64Array(p.weights), { vol: p.risk, ret: p.return, sharpe: p.sharpe });
      }
    });
  }, [points, lockedIdx, onPointHover]);

  const handlePointerLeave = useCallback(() => {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (lockedIdx === null) { setCursor(null); onPointHover?.(null, null, null); }
  }, [lockedIdx, onPointHover]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const ox = e.nativeEvent.offsetX;
    const xs = xScaleRef.current;
    if (!xs || points.length === 0) return;
    const riskPct = xs.invert(ox);
    let nearestIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(points[i]!.risk * 100 - riskPct);
      if (dist < minDist) { minDist = dist; nearestIdx = i; }
    }
    if (lockedIdx === nearestIdx) {
      setLockedIdx(null);
      onPointSelect?.(null);
    } else {
      setLockedIdx(nearestIdx);
      onPointSelect?.(nearestIdx);
    }
  }, [points, lockedIdx, onPointSelect]);

  // Sync locked cursor position
  useEffect(() => {
    if (lockedIdx == null || !xScaleRef.current || !yScaleRef.current || points.length === 0) return;
    const p = points[lockedIdx];
    if (!p) return;
    setCursor({
      svgX: xScaleRef.current(p.risk   * 100) + M.left,
      svgY: yScaleRef.current(p.return * 100) + M.top,
      idx: lockedIdx,
    });
    onPointHover?.(lockedIdx, new Float64Array(p.weights), { vol: p.risk, ret: p.return, sharpe: p.sharpe });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedIdx]);

  // Reset on data change
  useEffect(() => { setLockedIdx(null); setCursor(null); }, [points]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const iW   = width  - M.left - M.right;
  const iH   = chartH - M.top  - M.bottom;
  const activeCursor = cursor;

  // Hover tooltip content
  const tooltipPoint = activeCursor ? points[activeCursor.idx] : null;
  const top3 = tooltipPoint
    ? tooltipPoint.weights
        .map((w, i) => ({ w, ticker: tickers[i] ?? `A${i}` }))
        .sort((a, b) => b.w - a.w)
        .slice(0, 3)
    : [];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* Point-mode contextual note */}
      {pointMode && points.length > 0 && (
        <p
          style={{
            paddingLeft: M.left,
            paddingBottom: 8,
            fontSize: 12,
            fontFamily: 'var(--font-mono, monospace)',
            color: '#6B6B73',
          }}
        >
          Single-portfolio optimisation — drag is disabled
        </p>
      )}

      {/* Algorithm toggle row — frontier mode only */}
      {!pointMode && onToggleAlgorithm && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            paddingLeft: M.left,
            paddingBottom: 10,
          }}
        >
          {Object.entries(ALGO_META).map(([key, meta]) => {
            const active = visibleAlgorithms.has(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => onToggleAlgorithm(key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  opacity: active ? 1 : 0.45,
                  transition: `opacity var(--duration-micro) var(--ease)`,
                }}
              >
                {/* Checkbox square */}
                <span
                  style={{
                    display: 'inline-block',
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    border: `1.5px solid ${meta.color}`,
                    background: active ? meta.color : 'transparent',
                    flexShrink: 0,
                    transition: `background var(--duration-micro) var(--ease)`,
                  }}
                />
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: active ? meta.color : C.textTertiary,
                    transition: `color var(--duration-micro) var(--ease)`,
                  }}
                >
                  {meta.label}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Main chart */}
      <div
        ref={containerRef}
        style={{ position: 'relative', width: '100%', height: chartH }}
      >
        {/* D3 static layer */}
        <svg
          ref={svgRef}
          width={width}
          height={chartH}
          style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
        />

        {/* React cursor layer */}
        {activeCursor && points.length > 0 && (
          <svg
            width={width}
            height={chartH}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
          >
            {/* Vertical crosshair */}
            <line
              x1={activeCursor.svgX} y1={M.top}
              x2={activeCursor.svgX} y2={chartH - M.bottom}
              stroke={C.borderStrong}
              strokeWidth={1}
              strokeDasharray="3,3"
            />
            {/* Hover ring */}
            <circle
              cx={activeCursor.svgX}
              cy={activeCursor.svgY}
              r={6}
              fill={C.accent}
              stroke={C.bg}
              strokeWidth={2}
              style={{ transition: `cx var(--duration-micro) var(--ease), cy var(--duration-micro) var(--ease)` }}
            />
            {/* Lock outer ring */}
            {lockedIdx != null && (
              <circle
                cx={activeCursor.svgX}
                cy={activeCursor.svgY}
                r={12}
                fill="none"
                stroke={C.accent}
                strokeWidth={1.5}
                strokeOpacity={0.5}
              />
            )}
          </svg>
        )}

        {/* Hover tooltip — top-right corner */}
        {tooltipPoint && (
          <div
            style={{
              position: 'absolute',
              top: M.top,
              right: M.right,
              background: 'var(--surface-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '8px 12px',
              pointerEvents: 'none',
              minWidth: 140,
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: 'var(--text-tertiary)' }}>Return</span>
                <span style={{ color: tooltipPoint.return >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
                  {tooltipPoint.return >= 0 ? '+' : ''}{(tooltipPoint.return * 100).toFixed(2)}%
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: 'var(--text-tertiary)' }}>Vol</span>
                <span style={{ color: 'var(--text-primary)' }}>{(tooltipPoint.risk * 100).toFixed(2)}%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: 'var(--text-tertiary)' }}>Sharpe</span>
                <span style={{ color: 'var(--accent)' }}>{tooltipPoint.sharpe.toFixed(3)}</span>
              </div>
              {top3.length > 0 && (
                <>
                  <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '4px 0 2px' }} />
                  {top3.map(({ w, ticker }) => (
                    <div key={ticker} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{ticker}</span>
                      <span style={{ color: 'var(--text-primary)' }}>{(w * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        )}

        {/* Algorithm marker hit areas for algo tooltip */}
        {algorithmMarkers.map((m) => {
          if (!visibleAlgorithms.has(m.algorithm) || !xScaleRef.current || !yScaleRef.current) return null;
          const ax = xScaleRef.current(m.vol * 100) + M.left;
          const ay = yScaleRef.current(m.ret * 100) + M.top;
          return (
            <div
              key={m.algorithm}
              style={{ position: 'absolute', left: ax - 10, top: ay - 10, width: 20, height: 20, cursor: 'default' }}
              onPointerEnter={(e) => {
                const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                setAlgoTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, m });
              }}
              onPointerLeave={() => setAlgoTip(null)}
            />
          );
        })}

        {/* Algo tooltip */}
        {algoTip && (
          <div
            style={{
              position: 'absolute',
              left: algoTip.x + 12,
              top: algoTip.y - 8,
              background: 'var(--surface-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '6px 10px',
              pointerEvents: 'none',
              zIndex: 20,
            }}
          >
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
              {ALGO_META[algoTip.m.algorithm]?.label ?? algoTip.m.algorithm}
            </p>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span>Ret: <span style={{ color: 'var(--positive)' }}>{(algoTip.m.ret * 100).toFixed(2)}%</span></span>
              <span>Vol: <span style={{ color: 'var(--text-primary)' }}>{(algoTip.m.vol * 100).toFixed(2)}%</span></span>
              <span>Sharpe: <span style={{ color: 'var(--accent)' }}>{algoTip.m.sharpe.toFixed(3)}</span></span>
            </div>
          </div>
        )}

        {/* Event capture overlay */}
        {points.length > 0 && (
          <div
            style={{ position: 'absolute', left: M.left, top: M.top, width: iW, height: iH, cursor: 'crosshair' }}
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
            onClick={handleClick}
          />
        )}
      </div>

      {/* Weight heatmap strip */}
      {points.length > 0 && tickers.length > 0 && (
        <div style={{ position: 'relative' }}>
          <svg
            ref={heatmapRef}
            width={width}
            height={HEATMAP_H}
            style={{ overflow: 'visible', display: 'block' }}
          />
        </div>
      )}
    </div>
  );
}
