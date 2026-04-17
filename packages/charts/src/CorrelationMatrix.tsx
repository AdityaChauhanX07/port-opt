'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CorrelationMatrixProps {
  /** Flat row-major n×n correlation matrix. */
  matrix: Float64Array;
  tickers: string[];
  /** Row-major returns (nRetPeriods × nAssets) — used for click-to-scatter. */
  returns?: Float64Array | null;
  nAssets: number;
}

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

function corrColor(v: number): string {
  // Diverging: muted red (-1) → near-neutral (0) → muted blue (+1)
  const t = Math.max(-1, Math.min(1, v));
  if (t < 0) {
    const a = -t;
    const r = Math.round(26 + a * (148 - 26));
    const gv = Math.round(26 + a * (48 - 26));
    const b = Math.round(26 + a * (48 - 26));
    return `rgb(${r},${gv},${b})`;
  } else {
    const a = t;
    const r = Math.round(26 + a * (42 - 26));
    const gv = Math.round(26 + a * (78 - 26));
    const b = Math.round(26 + a * (160 - 26));
    return `rgb(${r},${gv},${b})`;
  }
}

// ---------------------------------------------------------------------------
// OLS helper
// ---------------------------------------------------------------------------

function ols(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: 0 };
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const slope = den > 0 ? num / den : 0;
  return { slope, intercept: my - slope * mx };
}

// ---------------------------------------------------------------------------
// Scatter sub-component
// ---------------------------------------------------------------------------

interface ScatterProps {
  xs: number[];
  ys: number[];
  xLabel: string;
  yLabel: string;
  corr: number;
  height?: number;
}

function CorrelationScatter({ xs, ys, xLabel, yLabel, corr, height = 260 }: ScatterProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(440);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.max(e.contentRect.width, 200));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!svgRef.current || xs.length === 0) return;

    const M = { top: 12, right: 16, bottom: 36, left: 52 };
    const iW = width - M.left - M.right;
    const iH = height - M.top - M.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g').attr('transform', `translate(${M.left},${M.top})`);

    const [xMin = -0.1, xMax = 0.1] = d3.extent(xs) as [number, number];
    const [yMin = -0.1, yMax = 0.1] = d3.extent(ys) as [number, number];
    const xPad = (xMax - xMin) * 0.08;
    const yPad = (yMax - yMin) * 0.08;

    const xScale = d3.scaleLinear().domain([xMin - xPad, xMax + xPad]).range([0, iW]);
    const yScale = d3.scaleLinear().domain([yMin - yPad, yMax + yPad]).range([iH, 0]);

    const styleAxis = (sel: d3.Selection<SVGGElement, unknown, null, undefined>) => {
      sel.select('.domain').attr('stroke', '#525252');
      sel.selectAll('.tick line').attr('stroke', '#525252');
      sel.selectAll<SVGTextElement, unknown>('.tick text').attr('fill', '#737373').attr('font-size', 10);
    };

    g.append('g').attr('transform', `translate(0,${iH})`).call(d3.axisBottom(xScale).ticks(5).tickFormat(d3.format('.2%'))).call(styleAxis);
    g.append('g').call(d3.axisLeft(yScale).ticks(5).tickFormat(d3.format('.2%'))).call(styleAxis);

    // Zero lines
    const zx = xScale(0);
    const zy = yScale(0);
    if (zx >= 0 && zx <= iW) {
      g.append('line').attr('x1', zx).attr('x2', zx).attr('y1', 0).attr('y2', iH)
        .attr('stroke', 'rgba(255,255,255,0.06)').attr('stroke-width', 1);
    }
    if (zy >= 0 && zy <= iH) {
      g.append('line').attr('x1', 0).attr('x2', iW).attr('y1', zy).attr('y2', zy)
        .attr('stroke', 'rgba(255,255,255,0.06)').attr('stroke-width', 1);
    }

    // Scatter points
    g.selectAll('circle')
      .data(xs)
      .join('circle')
      .attr('cx', (_, i) => xScale(xs[i]))
      .attr('cy', (_, i) => yScale(ys[i]))
      .attr('r', 2.5)
      .attr('fill', '#5e8eff')
      .attr('opacity', 0.45);

    // OLS line
    const { slope, intercept } = ols(xs, ys);
    const x0 = xMin - xPad;
    const x1 = xMax + xPad;
    g.append('line')
      .attr('x1', xScale(x0)).attr('x2', xScale(x1))
      .attr('y1', yScale(slope * x0 + intercept)).attr('y2', yScale(slope * x1 + intercept))
      .attr('stroke', '#8b5cf6')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '5 3');

    // Axis labels
    g.append('text')
      .attr('x', iW / 2).attr('y', iH + 28)
      .attr('text-anchor', 'middle').attr('fill', '#737373').attr('font-size', 11)
      .text(xLabel);

    g.append('text')
      .attr('transform', `translate(-36,${iH / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle').attr('fill', '#737373').attr('font-size', 11)
      .text(yLabel);

    // Correlation label
    g.append('text')
      .attr('x', iW - 2).attr('y', 10)
      .attr('text-anchor', 'end').attr('fill', '#a3a3a3').attr('font-size', 11)
      .text(`ρ = ${corr.toFixed(3)}`);
  }, [xs, ys, xLabel, yLabel, corr, width, height]);

  return (
    <div ref={containerRef} style={{ height }}>
      <svg ref={svgRef} width={width} height={height} className="overflow-visible" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main heatmap component
// ---------------------------------------------------------------------------

export function CorrelationMatrix({ matrix, tickers, returns, nAssets }: CorrelationMatrixProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [containerWidth, setContainerWidth] = useState(560);
  const [selectedCell, setSelectedCell] = useState<[number, number] | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; i: number; j: number; v: number } | null>(null);

  const n = nAssets;
  const cellSize = Math.max(40, Math.floor(Math.min(600, containerWidth) / n));
  const totalSize = cellSize * n;
  const labelPad = 52;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setContainerWidth(Math.max(e.contentRect.width, 200));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const draw = useCallback(() => {
    if (!svgRef.current || matrix.length < n * n || n < 2) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g').attr('transform', `translate(${labelPad},${labelPad})`);

    // Cells
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = matrix[i * n + j] ?? 0;
        const isSelected = selectedCell && (selectedCell[0] === i || selectedCell[1] === j || selectedCell[0] === j || selectedCell[1] === i);

        g.append('rect')
          .datum({ i, j, v })
          .attr('class', 'cell')
          .attr('x', j * cellSize).attr('y', i * cellSize)
          .attr('width', cellSize - 1).attr('height', cellSize - 1)
          .attr('fill', corrColor(v))
          .attr('opacity', isSelected ? 1 : 0.92)
          .attr('rx', 2)
          .style('cursor', 'pointer')
          .on('mouseenter', function (event, d) {
            const { i: hi, j: hj } = d as { i: number; j: number; v: number };
            // Highlight row + column
            g.selectAll<SVGRectElement, { i: number; j: number; v: number }>('.cell')
              .attr('opacity', (c) => c.i === hi || c.j === hj ? 1 : 0.3);
            // Tooltip
            const [cx, cy] = d3.pointer(event, containerRef.current!);
            setTooltip({ x: cx, y: cy, i: hi, j: hj, v: (d as { v: number }).v });
          })
          .on('mouseleave', function () {
            g.selectAll('.cell').attr('opacity', 0.92);
            setTooltip(null);
          })
          .on('click', (_, d) => {
            const { i: ci, j: cj } = d as { i: number; j: number };
            if (ci !== cj) {
              setSelectedCell((prev) =>
                prev && prev[0] === ci && prev[1] === cj ? null : [ci, cj]
              );
            }
          });

        // Cell value text
        const fontSize = cellSize < 50 ? 9 : cellSize < 70 ? 10 : 11;
        const textColor = Math.abs(v) > 0.5 ? 'rgba(255,255,255,0.9)' : '#a3a3a3';
        g.append('text')
          .attr('x', j * cellSize + cellSize / 2)
          .attr('y', i * cellSize + cellSize / 2 + 4)
          .attr('text-anchor', 'middle')
          .attr('font-size', fontSize)
          .attr('font-family', 'var(--font-mono), monospace')
          .attr('fill', textColor)
          .attr('pointer-events', 'none')
          .text(v.toFixed(2));
      }
    }

    // Tick labels — rows (left)
    for (let i = 0; i < n; i++) {
      svg.append('text')
        .attr('x', labelPad - 6)
        .attr('y', labelPad + i * cellSize + cellSize / 2 + 4)
        .attr('text-anchor', 'end')
        .attr('font-size', Math.max(9, Math.min(11, cellSize / 4.5)))
        .attr('font-family', 'var(--font-mono), monospace')
        .attr('fill', '#a3a3a3')
        .text(tickers[i] ?? '');
    }

    // Tick labels — columns (top)
    for (let j = 0; j < n; j++) {
      svg.append('text')
        .attr('x', labelPad + j * cellSize + cellSize / 2)
        .attr('y', labelPad - 6)
        .attr('text-anchor', 'middle')
        .attr('font-size', Math.max(9, Math.min(11, cellSize / 4.5)))
        .attr('font-family', 'var(--font-mono), monospace')
        .attr('fill', '#a3a3a3')
        .text(tickers[j] ?? '');
    }
  }, [matrix, tickers, n, cellSize, labelPad, selectedCell]);

  useEffect(() => { draw(); }, [draw]);

  // Scatter data for clicked cell
  const scatterData = (() => {
    if (!selectedCell || !returns || returns.length < n) return null;
    const [ci, cj] = selectedCell;
    const nRetPeriods = Math.floor(returns.length / n);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let t = 0; t < nRetPeriods; t++) {
      xs.push(returns[t * n + ci]);
      ys.push(returns[t * n + cj]);
    }
    return {
      xs,
      ys,
      xLabel: tickers[ci] ?? `A${ci}`,
      yLabel: tickers[cj] ?? `A${cj}`,
      corr: matrix[ci * n + cj] ?? 0,
    };
  })();

  const svgWidth = totalSize + labelPad;
  const svgHeight = totalSize + labelPad;
  const tooltipRight = tooltip && tooltip.x > containerWidth * 0.6;

  return (
    <div ref={containerRef}>
      <div style={{ maxWidth: svgWidth, position: 'relative' }}>
        <svg
          ref={svgRef}
          width={svgWidth}
          height={svgHeight}
          className="overflow-visible"
        />

        {tooltip && (
          <div
            className="absolute pointer-events-none z-20 rounded border text-xs shadow-lg"
            style={{
              left: tooltipRight ? tooltip.x - 160 : tooltip.x + 10,
              top: Math.max(8, tooltip.y - 20),
              background: '#111111',
              borderColor: 'rgba(255,255,255,0.08)',
              padding: '7px 10px',
              minWidth: 140,
            }}
          >
            <div className="mb-1 text-[#737373]">
              {tickers[tooltip.i]} × {tickers[tooltip.j]}
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-[#a3a3a3]">correlation</span>
              <span
                className="tabular-nums font-medium"
                style={{ color: tooltip.v > 0 ? '#4a6fbc' : tooltip.v < 0 ? '#c75454' : '#a3a3a3' }}
              >
                {tooltip.v.toFixed(3)}
              </span>
            </div>
            {tooltip.i !== tooltip.j && (
              <div className="mt-1 text-[10px] text-[#525252]">click to plot scatter</div>
            )}
          </div>
        )}
      </div>

      {scatterData && (
        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-4" style={{ maxWidth: 520 }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[12px] font-medium text-[#a3a3a3]">
              <span className="font-mono text-[#f5f5f5]">{scatterData.xLabel}</span>
              <span className="mx-1.5 text-[#525252]">vs</span>
              <span className="font-mono text-[#f5f5f5]">{scatterData.yLabel}</span>
            </p>
            <button
              onClick={() => setSelectedCell(null)}
              className="text-[11px] text-[#525252] hover:text-[#a3a3a3] transition-colors"
            >
              ✕
            </button>
          </div>
          <CorrelationScatter
            xs={scatterData.xs}
            ys={scatterData.ys}
            xLabel={scatterData.xLabel}
            yLabel={scatterData.yLabel}
            corr={scatterData.corr}
            height={240}
          />
        </div>
      )}
    </div>
  );
}
