'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EquitySeries {
  label: string;
  values: number[] | Float64Array;
  color: string;
  dashed?: boolean;
  width?: number;
}

export interface EquityChartProps {
  series: EquitySeries[];
  /** Date strings for each data point (same length as series values). */
  dates: string[];
  /** Index into dates where OOS begins — draws a vertical dashed rule. */
  oosStartIdx?: number | null;
  logScale?: boolean;
  hoverIdx?: number | null;
  onHover?: (idx: number | null) => void;
  height?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const M = { top: 16, right: 24, bottom: 36, left: 60 };
const COLORS = {
  grid:         'var(--border-subtle)',
  axis:         'var(--border)',
  tick:         'var(--text-tertiary)',
  oos:          'var(--border-strong)',
  crosshair:    'var(--border-strong)',
  tooltip:      'var(--surface-elevated)',
  tooltipBorder:'var(--border)',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EquityChart({
  series,
  dates,
  oosStartIdx,
  logScale = false,
  hoverIdx,
  onHover,
  height = 280,
}: EquityChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(640);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    idx: number;
  } | null>(null);

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

    // Scales
    const allValues = series.flatMap((s) => Array.from(s.values));
    const [yMin = 0, yMax = 2] = d3.extent(allValues.filter(isFinite)) as [number, number];
    const yPad = (yMax - yMin) * 0.04;

    const x = d3.scaleLinear().domain([0, dates.length - 1]).range([0, iW]);
    const y = logScale
      ? d3.scaleLog()
          .domain([Math.max(yMin - yPad, 0.001), yMax + yPad])
          .range([iH, 0])
          .clamp(true)
      : d3.scaleLinear()
          .domain([yMin - yPad, yMax + yPad])
          .range([iH, 0]);

    // Grid lines
    const yTicks = y.ticks(6);
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
      .ticks(5)
      .tickFormat((d) => `${(+d).toFixed(1)}×`);

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

    // Baseline at y=1
    if (!logScale) {
      const baseY = y(1);
      if (baseY >= 0 && baseY <= iH) {
        g.append('line')
          .attr('x1', 0).attr('x2', iW)
          .attr('y1', baseY).attr('y2', baseY)
          .attr('stroke', 'var(--border)')
          .attr('stroke-dasharray', '4 4')
          .attr('stroke-width', 1);
      }
    }

    // OOS marker
    if (oosStartIdx != null && oosStartIdx > 0 && oosStartIdx < dates.length) {
      const oosX = x(oosStartIdx);
      g.append('line')
        .attr('x1', oosX).attr('x2', oosX)
        .attr('y1', 0).attr('y2', iH)
        .attr('stroke', COLORS.oos)
        .attr('stroke-dasharray', '6 4')
        .attr('stroke-width', 1);

      g.append('text')
        .attr('x', oosX + 4)
        .attr('y', 12)
        .attr('fill', 'var(--text-tertiary)')
        .attr('font-size', 10)
        .text('OOS');
    }

    // Series lines
    const lineFn = d3.line<number>()
      .x((_, i) => x(i))
      .y((d) => y(d) as number)
      .defined(isFinite)
      .curve(d3.curveMonotoneX);

    for (const s of series) {
      const vals = Array.from(s.values);
      g.append('path')
        .datum(vals)
        .attr('fill', 'none')
        .attr('stroke', s.color)
        .attr('stroke-width', s.width ?? 1.5)
        .attr('stroke-dasharray', s.dashed ? '6 4' : null)
        .attr('opacity', 0.9)
        .attr('d', lineFn);
    }

    // Crosshair group (managed separately for hover updates)
    const crosshair = g.append('g')
      .attr('class', 'crosshair')
      .attr('pointer-events', 'none')
      .attr('opacity', 0);

    crosshair.append('line')
      .attr('class', 'ch-v')
      .attr('y1', 0).attr('y2', iH)
      .attr('stroke', COLORS.crosshair)
      .attr('stroke-width', 1);

    // Dots for each series at crosshair position
    for (const s of series) {
      crosshair.append('circle')
        .attr('class', `ch-dot-${s.label.replace(/\s+/g, '_')}`)
        .attr('r', 4)
        .attr('fill', s.color)
        .attr('stroke', 'var(--bg)')
        .attr('stroke-width', 1.5);
    }

    // Invisible overlay for mouse events
    g.append('rect')
      .attr('width', iW).attr('height', iH)
      .attr('fill', 'transparent')
      .on('mousemove', function (event) {
        const [mx] = d3.pointer(event);
        const idx = Math.round(x.invert(mx));
        const clamped = Math.max(0, Math.min(idx, dates.length - 1));
        onHover?.(clamped);
        const [cx, cy] = d3.pointer(event, containerRef.current!);
        setTooltip({ x: cx, y: cy, idx: clamped });
      })
      .on('mouseleave', () => {
        onHover?.(null);
        setTooltip(null);
      });
  }, [series, dates, width, height, logScale, oosStartIdx, onHover]);

  useEffect(() => { draw(); }, [draw]);

  // Update crosshair position without full redraw
  useEffect(() => {
    if (!svgRef.current) return;
    const iW = width - M.left - M.right;
    const iH = height - M.top - M.bottom;
    const allValues = series.flatMap((s) => Array.from(s.values));
    const [yMin = 0, yMax = 2] = d3.extent(allValues.filter(isFinite)) as [number, number];
    const yPad = (yMax - yMin) * 0.04;
    const x = d3.scaleLinear().domain([0, dates.length - 1]).range([0, iW]);
    const y = logScale
      ? d3.scaleLog().domain([Math.max(yMin - yPad, 0.001), yMax + yPad]).range([iH, 0]).clamp(true)
      : d3.scaleLinear().domain([yMin - yPad, yMax + yPad]).range([iH, 0]);

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
          .attr('cy', y(+v) as number);
      }
    }
  }, [hoverIdx, series, dates, width, height, logScale]);

  const tooltipRight = tooltip && tooltip.x > width * 0.6;

  return (
    <div ref={containerRef} className="relative w-full" style={{ height }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="overflow-visible"
      />

      {/* Tooltip */}
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
          <div className="mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
            {dates[tooltip.idx] ?? ''}
          </div>
          {series.map((s) => {
            const v = s.values[tooltip!.idx];
            return (
              <div key={s.label} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5" style={{ color: s.color }}>
                  <span
                    className="inline-block h-1.5 w-3 rounded-full"
                    style={{ background: s.color, opacity: s.dashed ? 0.6 : 1 }}
                  />
                  {s.label}
                </span>
                <span className="font-medium tabular-nums" style={{ color: 'var(--text-primary)' }}>
                  {v != null && isFinite(+v) ? (+v).toFixed(3) : '—'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
