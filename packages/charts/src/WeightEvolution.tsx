'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WeightEvolutionProps {
  /** Flat row-major weight matrix (nRebalances × nAssets). */
  weightsHistory: Float64Array | number[];
  /** [nRebalances, nAssets] */
  weightsShape: [number, number];
  /** Date string for each rebalance step. */
  rebalanceDates: string[];
  tickers: string[];
  height?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const M = { top: 12, right: 140, bottom: 36, left: 24 };

const PALETTE = [
  '#5e8eff',
  '#3fb950',
  '#f59e0b',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#14b8a6',
  '#6366f1',
  '#d97706',
  '#a78bfa',
];

const COLORS = {
  axis: '#525252',
  tick: '#737373',
  tooltip: '#111111',
  tooltipBorder: 'rgba(255,255,255,0.08)',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WeightEvolution({
  weightsHistory,
  weightsShape,
  rebalanceDates,
  tickers,
  height = 240,
}: WeightEvolutionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(640);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    idx: number;
    weights: number[];
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setWidth(Math.max(e.contentRect.width, 200));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const draw = useCallback(() => {
    if (!svgRef.current) return;
    const [nReb, nAssets] = weightsShape;
    if (nReb === 0 || nAssets === 0) return;

    const iW = width - M.left - M.right;
    const iH = height - M.top - M.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g').attr('transform', `translate(${M.left},${M.top})`);

    // Build row-major matrix as array of objects for d3.stack
    const rows: Record<string, number>[] = [];
    for (let r = 0; r < nReb; r++) {
      const row: Record<string, number> = { idx: r };
      for (let a = 0; a < nAssets; a++) {
        const ticker = tickers[a] ?? `A${a}`;
        row[ticker] = weightsHistory[r * nAssets + a] ?? 0;
      }
      rows.push(row);
    }

    const keys = tickers.slice(0, nAssets).map((t, i) => tickers[i] ?? `A${i}`);

    const stack = d3.stack<Record<string, number>>().keys(keys);
    const stacked = stack(rows);

    const x = d3.scaleLinear().domain([0, nReb - 1]).range([0, iW]);
    const y = d3.scaleLinear().domain([0, 1]).range([iH, 0]);

    // Gridlines at 25% / 50% / 75%
    g.append('g')
      .selectAll('line')
      .data([0.25, 0.5, 0.75])
      .join('line')
      .attr('x1', 0).attr('x2', iW)
      .attr('y1', (d) => y(d)).attr('y2', (d) => y(d))
      .attr('stroke', 'rgba(255,255,255,0.05)')
      .attr('stroke-width', 1);

    // Y axis
    g.append('g')
      .call(
        d3.axisLeft(y)
          .ticks(4)
          .tickFormat((d) => `${(+d * 100).toFixed(0)}%`),
      )
      .call((sel) => {
        sel.select('.domain').attr('stroke', COLORS.axis);
        sel.selectAll('.tick line').attr('stroke', COLORS.axis);
        sel.selectAll<SVGTextElement, unknown>('.tick text')
          .attr('fill', COLORS.tick)
          .attr('font-size', 11);
      });

    // X axis
    const step = Math.max(1, Math.floor(nReb / 6));
    g.append('g')
      .attr('transform', `translate(0,${iH})`)
      .call(
        d3.axisBottom(x)
          .tickValues(d3.range(0, nReb, step))
          .tickFormat((d) => {
            const date = rebalanceDates[Math.round(+d)];
            return date ? date.slice(0, 7) : '';
          }),
      )
      .call((sel) => {
        sel.select('.domain').attr('stroke', COLORS.axis);
        sel.selectAll('.tick line').attr('stroke', COLORS.axis);
        sel.selectAll<SVGTextElement, unknown>('.tick text')
          .attr('fill', COLORS.tick)
          .attr('font-size', 11);
      });

    // Area generator
    const areaFn = d3.area<d3.SeriesPoint<Record<string, number>>>()
      .x((d) => x(d.data['idx'] as number))
      .y0((d) => y(d[0]))
      .y1((d) => y(d[1]))
      .curve(d3.curveMonotoneX);

    for (const layer of stacked) {
      const color = PALETTE[keys.indexOf(layer.key) % PALETTE.length];
      g.append('path')
        .datum(layer)
        .attr('fill', color)
        .attr('fill-opacity', 0.85)
        .attr('stroke', '#0a0a0a')
        .attr('stroke-width', 0.5)
        .attr('d', areaFn);
    }

    // Legend (right side)
    const legend = svg.append('g')
      .attr('transform', `translate(${M.left + iW + 16}, ${M.top})`);

    keys.forEach((k, i) => {
      const color = PALETTE[i % PALETTE.length];
      legend.append('rect')
        .attr('x', 0).attr('y', i * 18)
        .attr('width', 10).attr('height', 10)
        .attr('fill', color)
        .attr('rx', 2);
      legend.append('text')
        .attr('x', 14).attr('y', i * 18 + 9)
        .attr('fill', '#a3a3a3')
        .attr('font-size', 11)
        .text(k);
    });

    // Mouse overlay
    g.append('rect')
      .attr('width', iW).attr('height', iH)
      .attr('fill', 'transparent')
      .on('mousemove', function (event) {
        const [mx] = d3.pointer(event);
        const idx = Math.max(0, Math.min(Math.round(x.invert(mx)), nReb - 1));
        const weights: number[] = [];
        for (let a = 0; a < nAssets; a++) {
          weights.push(weightsHistory[idx * nAssets + a] ?? 0);
        }
        const [cx, cy] = d3.pointer(event, containerRef.current!);
        setTooltip({ x: cx, y: cy, idx, weights });
      })
      .on('mouseleave', () => setTooltip(null));
  }, [weightsHistory, weightsShape, rebalanceDates, tickers, width, height]);

  useEffect(() => { draw(); }, [draw]);

  const tooltipRight = tooltip && tooltip.x > width * 0.6;

  return (
    <div ref={containerRef} className="relative w-full" style={{ height }}>
      <svg ref={svgRef} width={width} height={height} className="overflow-visible" />

      {tooltip != null && (
        <div
          className="absolute pointer-events-none z-20 rounded border text-xs shadow-lg"
          style={{
            left: tooltipRight ? tooltip.x - 168 : tooltip.x + 12,
            top: Math.max(8, tooltip.y - 32),
            minWidth: 160,
            background: COLORS.tooltip,
            borderColor: COLORS.tooltipBorder,
            padding: '8px 10px',
          }}
        >
          <div className="mb-1.5 text-[#737373]">
            {rebalanceDates[tooltip.idx] ?? `Rebalance ${tooltip.idx + 1}`}
          </div>
          {tickers.slice(0, weightsShape[1]).map((t, i) => (
            <div key={t} className="flex items-center justify-between gap-3">
              <span style={{ color: PALETTE[i % PALETTE.length] }}>{t}</span>
              <span className="tabular-nums font-medium text-[#f5f5f5]">
                {((tooltip!.weights[i] ?? 0) * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
