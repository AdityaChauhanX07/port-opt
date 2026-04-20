'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DrawdownSeries {
  label: string;
  values: number[] | Float64Array;
  color: string;
  fillOpacity?: number;
}

export interface DrawdownChartProps {
  series: DrawdownSeries[];
  dates: string[];
  hoverIdx?: number | null;
  onHover?: (idx: number | null) => void;
  height?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const M = { top: 12, right: 24, bottom: 36, left: 60 };
const COLORS = {
  grid:         'var(--border-subtle)',
  axis:         'var(--border)',
  tick:         'var(--text-tertiary)',
  crosshair:    'var(--border-strong)',
  tooltip:      'var(--surface-elevated)',
  tooltipBorder:'var(--border)',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DrawdownChart({
  series,
  dates,
  hoverIdx,
  onHover,
  height = 180,
}: DrawdownChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(640);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; idx: number } | null>(null);

  // Resize observer
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

  // Main draw
  const draw = useCallback(() => {
    if (!svgRef.current || series.length === 0 || dates.length === 0) return;

    const iW = width - M.left - M.right;
    const iH = height - M.top - M.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg
      .append('g')
      .attr('transform', `translate(${M.left},${M.top})`);

    // Drawdown values are ≤ 0
    const allValues = series.flatMap((s) => Array.from(s.values));
    const [yMin = -0.5] = d3.extent(allValues.filter(isFinite)) as [number, number];
    const yPadded = Math.min(yMin * 1.08, -0.01);

    const x = d3.scaleLinear().domain([0, dates.length - 1]).range([0, iW]);
    const y = d3.scaleLinear().domain([yPadded, 0]).range([iH, 0]);

    // Grid
    const yTicks = y.ticks(4);
    g.append('g')
      .selectAll('line')
      .data(yTicks)
      .join('line')
      .attr('x1', 0).attr('x2', iW)
      .attr('y1', (d) => y(d as number)).attr('y2', (d) => y(d as number))
      .attr('stroke', COLORS.grid)
      .attr('stroke-width', 1);

    // Axes
    const xAxis = d3.axisBottom(x)
      .ticks(6)
      .tickFormat((d) => {
        const idx = Math.round(+d);
        const date = dates[Math.max(0, Math.min(idx, dates.length - 1))];
        return date ? date.slice(0, 7) : '';
      });

    const yAxis = d3.axisLeft(y)
      .ticks(4)
      .tickFormat((d) => `${(+d * 100).toFixed(0)}%`);

    const styleAxis = (sel: d3.Selection<SVGGElement, unknown, null, undefined>) => {
      sel.select('.domain').attr('stroke', COLORS.axis);
      sel.selectAll('.tick line').attr('stroke', COLORS.axis);
      sel.selectAll<SVGTextElement, unknown>('.tick text')
        .attr('fill', COLORS.tick)
        .attr('font-size', 11);
    };

    g.append('g')
      .attr('transform', `translate(0,${iH})`)
      .call(xAxis)
      .call(styleAxis);

    g.append('g')
      .call(yAxis)
      .call(styleAxis);

    // Zero baseline
    g.append('line')
      .attr('x1', 0).attr('x2', iW)
      .attr('y1', y(0)).attr('y2', y(0))
      .attr('stroke', 'var(--border)')
      .attr('stroke-width', 1);

    // Area + line for each series
    const areaFn = d3.area<number>()
      .x((_, i) => x(i))
      .y0(y(0))
      .y1((d) => y(Math.min(d, 0)) as number)
      .defined(isFinite)
      .curve(d3.curveMonotoneX);

    const lineFn = d3.line<number>()
      .x((_, i) => x(i))
      .y((d) => y(Math.min(d, 0)) as number)
      .defined(isFinite)
      .curve(d3.curveMonotoneX);

    for (const s of series) {
      const vals = Array.from(s.values);
      const fillOp = s.fillOpacity ?? 0.12;

      g.append('path')
        .datum(vals)
        .attr('fill', s.color)
        .attr('fill-opacity', fillOp)
        .attr('d', areaFn);

      g.append('path')
        .datum(vals)
        .attr('fill', 'none')
        .attr('stroke', s.color)
        .attr('stroke-width', 1.5)
        .attr('opacity', 0.8)
        .attr('d', lineFn);
    }

    // Crosshair group
    const crosshair = g.append('g')
      .attr('class', 'crosshair')
      .attr('pointer-events', 'none')
      .attr('opacity', 0);

    crosshair.append('line')
      .attr('class', 'ch-v')
      .attr('y1', 0).attr('y2', iH)
      .attr('stroke', COLORS.crosshair)
      .attr('stroke-width', 1);

    for (const s of series) {
      crosshair.append('circle')
        .attr('class', `ch-dot-${s.label.replace(/\s+/g, '_')}`)
        .attr('r', 3.5)
        .attr('fill', s.color)
        .attr('stroke', 'var(--bg)')
        .attr('stroke-width', 1.5);
    }

    // Overlay for mouse events
    g.append('rect')
      .attr('width', iW).attr('height', iH)
      .attr('fill', 'transparent')
      .on('mousemove', function (event) {
        const [mx] = d3.pointer(event);
        const idx = Math.max(0, Math.min(Math.round(x.invert(mx)), dates.length - 1));
        onHover?.(idx);
        const [cx, cy] = d3.pointer(event, containerRef.current!);
        setTooltip({ x: cx, y: cy, idx });
      })
      .on('mouseleave', () => {
        onHover?.(null);
        setTooltip(null);
      });
  }, [series, dates, width, height, onHover]);

  useEffect(() => { draw(); }, [draw]);

  // Crosshair update
  useEffect(() => {
    if (!svgRef.current) return;
    const iW = width - M.left - M.right;
    const iH = height - M.top - M.bottom;
    const allValues = series.flatMap((s) => Array.from(s.values));
    const [yMin = -0.5] = d3.extent(allValues.filter(isFinite)) as [number, number];
    const yPadded = Math.min(yMin * 1.08, -0.01);
    const x = d3.scaleLinear().domain([0, dates.length - 1]).range([0, iW]);
    const y = d3.scaleLinear().domain([yPadded, 0]).range([iH, 0]);

    const crosshair = d3.select(svgRef.current).select('g.crosshair');
    if (hoverIdx == null) {
      crosshair.attr('opacity', 0);
      return;
    }
    crosshair.attr('opacity', 1);
    const cx = x(hoverIdx);
    crosshair.select('.ch-v').attr('x1', cx).attr('x2', cx);
    for (const s of series) {
      const v = s.values[hoverIdx];
      if (v != null && isFinite(+v)) {
        crosshair
          .select(`.ch-dot-${s.label.replace(/\s+/g, '_')}`)
          .attr('cx', cx)
          .attr('cy', y(Math.min(+v, 0)) as number);
      }
    }
  }, [hoverIdx, series, dates, width, height]);

  const tooltipRight = tooltip && tooltip.x > width * 0.6;

  return (
    <div ref={containerRef} className="relative w-full" style={{ height }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="overflow-visible"
      />

      {tooltip != null && (
        <div
          className="absolute pointer-events-none z-20 rounded border text-xs shadow-lg"
          style={{
            left: tooltipRight ? tooltip.x - 156 : tooltip.x + 12,
            top: Math.max(8, tooltip.y - 24),
            minWidth: 148,
            background: COLORS.tooltip,
            borderColor: COLORS.tooltipBorder,
            padding: '8px 10px',
          }}
        >
          <div className="mb-1" style={{ color: 'var(--text-tertiary)' }}>{dates[tooltip.idx] ?? ''}</div>
          {series.map((s) => {
            const v = s.values[tooltip!.idx];
            return (
              <div key={s.label} className="flex items-center justify-between gap-3">
                <span style={{ color: s.color }}>{s.label}</span>
                <span className="tabular-nums font-medium" style={{ color: 'var(--text-primary)' }}>
                  {v != null && isFinite(+v) ? `${(+v * 100).toFixed(2)}%` : '—'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
