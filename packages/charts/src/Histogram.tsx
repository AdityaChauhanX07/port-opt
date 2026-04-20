'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HistogramMarker {
  value: number;
  label: string;
  color: string;
}

export interface HistogramProps {
  values:    number[];
  nBins?:    number;
  xLabel?:   string;
  markers?:  HistogramMarker[];
  height?:   number;
  barColor?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const M = { top: 16, right: 24, bottom: 44, left: 44 };
const COLORS = {
  grid:  'var(--border-subtle)',
  axis:  'var(--border)',
  tick:  'var(--text-tertiary)',
  label: 'var(--text-secondary)',
  bar:   'var(--accent)',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Histogram({
  values,
  nBins   = 40,
  xLabel,
  markers = [],
  height  = 200,
  barColor,
}: HistogramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef       = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(640);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.max(e.contentRect.width, 200));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const draw = useCallback(() => {
    if (!svgRef.current || values.length === 0) return;

    const iW = width  - M.left - M.right;
    const iH = height - M.top  - M.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g').attr('transform', `translate(${M.left},${M.top})`);

    const [xMin, xMax] = d3.extent(values) as [number, number];
    const xPad = (xMax - xMin) * 0.05 || 0.1;

    const x = d3.scaleLinear()
      .domain([xMin - xPad, xMax + xPad])
      .range([0, iW]);

    // Bin the values
    const binFn = d3.bin<number, number>()
      .domain(x.domain() as [number, number])
      .thresholds(x.ticks(nBins));

    const bins = binFn(values);
    const maxCount = d3.max(bins, (b) => b.length) ?? 1;

    const y = d3.scaleLinear().domain([0, maxCount]).range([iH, 0]);

    // Grid
    g.append('g')
      .selectAll('line')
      .data(y.ticks(4))
      .join('line')
      .attr('x1', 0).attr('x2', iW)
      .attr('y1', (d) => y(d as number)).attr('y2', (d) => y(d as number))
      .attr('stroke', COLORS.grid)
      .attr('stroke-width', 1);

    // Bars
    const fill = barColor ?? COLORS.bar;
    g.selectAll<SVGRectElement, d3.Bin<number, number>>('rect')
      .data(bins)
      .join('rect')
      .attr('x', (b) => x(b.x0 ?? 0) + 1)
      .attr('y', (b) => y(b.length))
      .attr('width', (b) => Math.max(x((b.x1 ?? 0)) - x(b.x0 ?? 0) - 1, 0))
      .attr('height', (b) => iH - y(b.length))
      .attr('fill', fill)
      .attr('opacity', 0.75)
      .attr('rx', 1);

    // Axes
    const styleAxis = (sel: d3.Selection<SVGGElement, unknown, null, undefined>) => {
      sel.select('.domain').attr('stroke', COLORS.axis);
      sel.selectAll('.tick line').attr('stroke', COLORS.axis);
      sel.selectAll<SVGTextElement, unknown>('.tick text')
        .attr('fill', COLORS.tick).attr('font-size', 11);
    };

    g.append('g')
      .attr('transform', `translate(0,${iH})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format('.2f')))
      .call(styleAxis);

    g.append('g')
      .call(d3.axisLeft(y).ticks(4))
      .call(styleAxis);

    // X label
    if (xLabel) {
      g.append('text')
        .attr('x', iW / 2).attr('y', iH + 38)
        .attr('text-anchor', 'middle')
        .attr('fill', COLORS.label).attr('font-size', 11)
        .text(xLabel);
    }

    // Vertical marker lines
    for (const m of markers) {
      const mx = x(m.value);
      if (mx < 0 || mx > iW) continue;

      g.append('line')
        .attr('x1', mx).attr('x2', mx)
        .attr('y1', 0).attr('y2', iH)
        .attr('stroke', m.color)
        .attr('stroke-dasharray', '5 4')
        .attr('stroke-width', 1.5)
        .attr('opacity', 0.85);

      g.append('text')
        .attr('x', mx + 4).attr('y', 12)
        .attr('fill', m.color)
        .attr('font-size', 10)
        .attr('font-family', 'var(--font-mono, monospace)')
        .text(m.label);
    }
  }, [values, nBins, markers, width, height, xLabel, barColor]);

  useEffect(() => { draw(); }, [draw]);

  return (
    <div ref={containerRef} className="relative w-full" style={{ height }}>
      {values.length === 0 ? (
        <div className="flex h-full items-center justify-center text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
          No data
        </div>
      ) : (
        <svg ref={svgRef} width={width} height={height} className="overflow-visible" />
      )}
    </div>
  );
}
