'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FrontierPoint {
  /** Annualised volatility (decimal, e.g. 0.15 = 15 %). */
  risk: number;
  /** Annualised return (decimal). */
  return: number;
  sharpe: number;
  /** Per-asset weights, same order as `tickers`. */
  weights: number[];
}

interface TooltipState {
  /** Container-relative position. */
  x: number;
  y: number;
  point: FrontierPoint;
  idx: number;
}

export interface EfficientFrontierProps {
  points: FrontierPoint[];
  bestIdx?: number | null;
  tickers: string[];
  selectedIdx?: number | null;
  onPointHover?: (point: FrontierPoint | null, idx: number | null) => void;
  onPointClick?: (point: FrontierPoint, idx: number) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const M = { top: 24, right: 32, bottom: 52, left: 64 };
const POINT_R = 5;
const SELECTED_R = 8;
const HIT_R = 16;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the SVG path for a 5-pointed star centred at (cx, cy). */
function starPath(cx: number, cy: number, ro: number, ri: number, n = 5) {
  const step = Math.PI / n;
  let d = '';
  for (let i = 0; i < 2 * n; i++) {
    const r = i % 2 === 0 ? ro : ri;
    const a = i * step - Math.PI / 2;
    d += `${i === 0 ? 'M' : 'L'}${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  }
  return d + 'Z';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EfficientFrontier({
  points,
  bestIdx,
  tickers,
  selectedIdx,
  onPointHover,
  onPointClick,
}: EfficientFrontierProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dims, setDims] = useState({ width: 600, height: 380 });
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  // ── ResizeObserver ──────────────────────────────────────────────────────
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

  // ── D3 draw ────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    if (!svgRef.current || points.length === 0) return;

    const { width, height } = dims;
    const iW = width - M.left - M.right;
    const iH = height - M.top - M.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg
      .append('g')
      .attr('transform', `translate(${M.left},${M.top})`);

    // ── Scales ──────────────────────────────────────────────────────────
    const risksPct  = points.map((p) => p.risk   * 100);
    const retsPct   = points.map((p) => p.return  * 100);
    const sharpeVals = points.map((p) => p.sharpe);

    const [rxMin = 0, rxMax = 1] = d3.extent(risksPct) as [number, number];
    const [ryMin = 0, ryMax = 1] = d3.extent(retsPct)  as [number, number];
    const xPad = Math.max((rxMax - rxMin) * 0.1, 0.5);
    const yPad = Math.max((ryMax - ryMin) * 0.1, 0.5);

    const x = d3.scaleLinear().domain([rxMin - xPad, rxMax + xPad]).range([0, iW]);
    const y = d3.scaleLinear().domain([ryMin - yPad, ryMax + yPad]).range([iH, 0]);

    const sharpeExt = d3.extent(sharpeVals) as [number, number];
    const colorScale = d3.scaleSequential()
      .domain(sharpeExt)
      .interpolator(d3.interpolate('#1e3a6e', '#2f81f7'));

    // ── Gridlines ───────────────────────────────────────────────────────
    g.append('g').selectAll('line')
      .data(x.ticks(6)).join('line')
      .attr('x1', (d) => x(d)).attr('x2', (d) => x(d))
      .attr('y1', 0).attr('y2', iH)
      .attr('stroke', '#1e1e1e').attr('stroke-width', 1);

    g.append('g').selectAll('line')
      .data(y.ticks(6)).join('line')
      .attr('x1', 0).attr('x2', iW)
      .attr('y1', (d) => y(d)).attr('y2', (d) => y(d))
      .attr('stroke', '#1e1e1e').attr('stroke-width', 1);

    // ── Axes ────────────────────────────────────────────────────────────
    const styleAxis = (sel: d3.Selection<SVGGElement, unknown, null, undefined>) => {
      sel.select('.domain').attr('stroke', '#333');
      sel.selectAll('.tick line').attr('stroke', '#333');
      sel.selectAll<SVGTextElement, unknown>('.tick text')
        .attr('fill', '#666').attr('font-size', 11);
    };

    g.append('g')
      .attr('transform', `translate(0,${iH})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat((d) => `${+d}%`))
      .call(styleAxis);

    g.append('g')
      .call(d3.axisLeft(y).ticks(6).tickFormat((d) => `${+d}%`))
      .call(styleAxis);

    // Axis labels
    g.append('text')
      .attr('x', iW / 2).attr('y', iH + 44)
      .attr('text-anchor', 'middle')
      .attr('fill', '#555').attr('font-size', 12)
      .text('Annual Volatility (%)');

    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -iH / 2).attr('y', -50)
      .attr('text-anchor', 'middle')
      .attr('fill', '#555').attr('font-size', 12)
      .text('Annual Return (%)');

    // ── Frontier line ───────────────────────────────────────────────────
    if (points.length > 1) {
      const lineFn = d3.line<FrontierPoint>()
        .x((p) => x(p.risk   * 100))
        .y((p) => y(p.return * 100))
        .curve(d3.curveMonotoneX);

      const path = g.append('path')
        .datum(points)
        .attr('fill', 'none')
        .attr('stroke', '#2f81f7')
        .attr('stroke-width', 2)
        .attr('opacity', 0.6)
        .attr('d', lineFn);

      // Dash-draw animation
      const len = (path.node() as SVGPathElement | null)?.getTotalLength() ?? 0;
      path
        .attr('stroke-dasharray', `${len} ${len}`)
        .attr('stroke-dashoffset', len)
        .transition()
        .duration(900)
        .ease(d3.easeCubicOut)
        .attr('stroke-dashoffset', 0);
    }

    // ── Dots ────────────────────────────────────────────────────────────
    g.selectAll<SVGCircleElement, FrontierPoint>('circle.dot')
      .data(points)
      .join('circle')
      .attr('class', 'dot')
      .attr('cx', (p) => x(p.risk   * 100))
      .attr('cy', (p) => y(p.return * 100))
      .attr('r', 0)
      .attr('fill', (p, i) =>
        selectedIdx === i ? '#2f81f7' : colorScale(p.sharpe)
      )
      .attr('stroke', (_, i) => (selectedIdx === i ? '#fff' : 'transparent'))
      .attr('stroke-width', 2)
      .attr('cursor', 'pointer')
      .transition()
      .delay((_, i) => 100 + i * 25)
      .duration(250)
      .attr('r', (_, i) => (selectedIdx === i ? SELECTED_R : POINT_R));

    // ── Transparent hit areas ────────────────────────────────────────────
    g.selectAll<SVGCircleElement, FrontierPoint>('circle.hit')
      .data(points)
      .join('circle')
      .attr('class', 'hit')
      .attr('cx', (p) => x(p.risk   * 100))
      .attr('cy', (p) => y(p.return * 100))
      .attr('r', HIT_R)
      .attr('fill', 'transparent')
      .attr('cursor', 'pointer')
      .on('mouseenter', function (event, d) {
        const [mx, my] = d3.pointer(event, containerRef.current!);
        const idx = points.indexOf(d);
        setTooltip({ x: mx, y: my, point: d, idx });
        onPointHover?.(d, idx);
      })
      .on('mouseleave', () => {
        setTooltip(null);
        onPointHover?.(null, null);
      })
      .on('click', (_, d) => {
        const idx = points.indexOf(d);
        onPointClick?.(d, idx);
      });

    // ── Best-point star ──────────────────────────────────────────────────
    if (bestIdx != null && points[bestIdx]) {
      const bp = points[bestIdx];
      g.append('path')
        .attr('d', starPath(x(bp.risk * 100), y(bp.return * 100), 10, 4))
        .attr('fill', '#f59e0b')
        .attr('stroke', '#000')
        .attr('stroke-width', 0.5)
        .attr('pointer-events', 'none')
        .attr('opacity', 0)
        .transition()
        .delay(900)
        .duration(400)
        .attr('opacity', 1);
    }
  }, [points, dims, bestIdx, selectedIdx, onPointHover, onPointClick]);

  useEffect(() => {
    draw();
  }, [draw]);

  // ── Tooltip position clamp ───────────────────────────────────────────────
  const tooltipLeft = tooltip
    ? tooltip.x > dims.width * 0.65
      ? tooltip.x - 200
      : tooltip.x + 16
    : 0;

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[300px]">
      {points.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-[#555]">
          Run an optimisation to see the frontier
        </div>
      ) : (
        <svg
          ref={svgRef}
          width={dims.width}
          height={dims.height}
          className="overflow-visible"
        />
      )}

      {tooltip && (
        <div
          className="absolute pointer-events-none z-20 rounded-lg border border-[#2a2a2a] bg-[#141414] p-3 shadow-2xl text-xs"
          style={{ left: tooltipLeft, top: tooltip.y - 8, minWidth: 180 }}
        >
          <p className="mb-1.5 font-semibold text-[#e5e5e5]">
            Portfolio {tooltip.idx + 1}
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[#888]">
            <span>Return</span>
            <span className="font-medium text-[#22c55e]">
              {(tooltip.point.return * 100).toFixed(2)}%
            </span>
            <span>Volatility</span>
            <span className="font-medium text-[#e5e5e5]">
              {(tooltip.point.risk * 100).toFixed(2)}%
            </span>
            <span>Sharpe</span>
            <span className="font-medium text-[#2f81f7]">
              {tooltip.point.sharpe.toFixed(3)}
            </span>
          </div>
          {tickers.length > 0 && tooltip.point.weights.length === tickers.length && (
            <div className="mt-2 space-y-0.5 border-t border-[#2a2a2a] pt-2">
              {tickers.map((t, i) => (
                <div key={t} className="flex justify-between gap-4 text-[#888]">
                  <span>{t}</span>
                  <span className="text-[#e5e5e5]">
                    {(tooltip.point.weights[i] * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
