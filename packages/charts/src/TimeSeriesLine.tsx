'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TimeSeriesLineSeries {
  label: string;
  values: Array<number | null>;
  color: string;
  dashed?: boolean;
  width?: number;
}

export interface TimeSeriesRefLine {
  y: number;
  stroke: string;
  dashArray?: string;
  label?: string;
}

export interface TimeSeriesLineProps {
  series: TimeSeriesLineSeries[];
  dates: string[];
  refLines?: TimeSeriesRefLine[];
  yFormat?: (v: number) => string;
  height?: number;
  hoverIdx?: number | null;
  onHover?: (idx: number | null) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const M = { top: 16, right: 24, bottom: 36, left: 56 };
const COL = {
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

export function TimeSeriesLine({
  series,
  dates,
  refLines = [],
  yFormat = (v) => v.toFixed(2),
  height = 240,
  hoverIdx,
  onHover,
}: TimeSeriesLineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(640);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; idx: number } | null>(null);

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
    if (!svgRef.current || series.length === 0 || dates.length === 0) return;

    const iW = width - M.left - M.right;
    const iH = height - M.top - M.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g').attr('transform', `translate(${M.left},${M.top})`);

    const nPts = dates.length;

    // Compute Y domain from all defined values + ref line values
    const allVals = [
      ...series.flatMap((s) => s.values.filter((v): v is number => v != null && isFinite(v))),
      ...refLines.map((r) => r.y),
    ];
    const [yMin = -1, yMax = 1] = d3.extent(allVals) as [number, number];
    const yPad = Math.max(Math.abs(yMax - yMin) * 0.08, 0.1);

    const x = d3.scaleLinear().domain([0, nPts - 1]).range([0, iW]);
    const y = d3.scaleLinear().domain([yMin - yPad, yMax + yPad]).range([iH, 0]);

    // Grid
    g.append('g')
      .selectAll('line')
      .data(y.ticks(5))
      .join('line')
      .attr('x1', 0).attr('x2', iW)
      .attr('y1', (d) => y(d as number)).attr('y2', (d) => y(d as number))
      .attr('stroke', COL.grid)
      .attr('stroke-width', 1);

    // Axes
    const styleAxis = (sel: d3.Selection<SVGGElement, unknown, null, undefined>) => {
      sel.select('.domain').attr('stroke', COL.axis);
      sel.selectAll('.tick line').attr('stroke', COL.axis);
      sel.selectAll<SVGTextElement, unknown>('.tick text')
        .attr('fill', COL.tick)
        .attr('font-size', 11);
    };

    g.append('g')
      .attr('transform', `translate(0,${iH})`)
      .call(
        d3.axisBottom(x)
          .ticks(6)
          .tickFormat((d) => {
            const idx = Math.round(+d);
            const date = dates[Math.max(0, Math.min(idx, dates.length - 1))];
            return date ? date.slice(0, 7) : '';
          })
      )
      .call(styleAxis);

    g.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat((d) => yFormat(+d)))
      .call(styleAxis);

    // Reference lines
    for (const rl of refLines) {
      const ry = y(rl.y);
      if (ry < 0 || ry > iH) continue;
      g.append('line')
        .attr('x1', 0).attr('x2', iW)
        .attr('y1', ry).attr('y2', ry)
        .attr('stroke', rl.stroke)
        .attr('stroke-dasharray', rl.dashArray ?? null)
        .attr('stroke-width', 1);

      if (rl.label) {
        g.append('text')
          .attr('x', iW - 2).attr('y', ry - 3)
          .attr('text-anchor', 'end')
          .attr('fill', COL.tick)
          .attr('font-size', 9)
          .text(rl.label);
      }
    }

    // Series lines
    const lineFn = (vals: Array<number | null>) =>
      d3.line<number | null>()
        .defined((d): d is number => d != null && isFinite(d))
        .x((_, i) => x(i))
        .y((d) => y(d!))
        .curve(d3.curveLinear)(vals);

    for (const s of series) {
      g.append('path')
        .attr('fill', 'none')
        .attr('stroke', s.color)
        .attr('stroke-width', s.width ?? 1.5)
        .attr('stroke-dasharray', s.dashed ? '6 4' : null)
        .attr('opacity', 0.9)
        .attr('d', lineFn(s.values));
    }

    // Crosshair
    const crosshair = g.append('g')
      .attr('class', 'crosshair')
      .attr('pointer-events', 'none')
      .attr('opacity', 0);

    crosshair.append('line')
      .attr('class', 'ch-v')
      .attr('y1', 0).attr('y2', iH)
      .attr('stroke', COL.crosshair)
      .attr('stroke-width', 1);

    for (const s of series) {
      crosshair.append('circle')
        .attr('class', `ch-dot-${s.label.replace(/\s+/g, '_')}`)
        .attr('r', 3.5)
        .attr('fill', s.color)
        .attr('stroke', 'var(--bg)')
        .attr('stroke-width', 1.5);
    }

    // Overlay for events
    g.append('rect')
      .attr('width', iW).attr('height', iH)
      .attr('fill', 'transparent')
      .on('mousemove', function (event) {
        const [mx] = d3.pointer(event);
        const idx = Math.max(0, Math.min(Math.round(x.invert(mx)), nPts - 1));
        onHover?.(idx);
        const [cx, cy] = d3.pointer(event, containerRef.current!);
        setTooltip({ x: cx, y: cy, idx });
      })
      .on('mouseleave', () => {
        onHover?.(null);
        setTooltip(null);
      });
  }, [series, dates, refLines, yFormat, width, height, onHover]);

  useEffect(() => { draw(); }, [draw]);

  // Update crosshair without full redraw
  useEffect(() => {
    if (!svgRef.current) return;
    const iW = width - M.left - M.right;
    const iH = height - M.top - M.bottom;
    const nPts = dates.length;
    const allVals = [
      ...series.flatMap((s) => s.values.filter((v): v is number => v != null && isFinite(v))),
      ...refLines.map((r) => r.y),
    ];
    const [yMin = -1, yMax = 1] = d3.extent(allVals) as [number, number];
    const yPad = Math.max(Math.abs(yMax - yMin) * 0.08, 0.1);
    const x = d3.scaleLinear().domain([0, nPts - 1]).range([0, iW]);
    const y = d3.scaleLinear().domain([yMin - yPad, yMax + yPad]).range([iH, 0]);

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
      if (v != null && isFinite(v)) {
        crosshair
          .select(`.ch-dot-${s.label.replace(/\s+/g, '_')}`)
          .attr('cx', cx)
          .attr('cy', y(v));
      }
    }
  }, [hoverIdx, series, dates, refLines, width, height]);

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
            background: COL.tooltip,
            borderColor: COL.tooltipBorder,
            padding: '8px 10px',
          }}
        >
          <div className="mb-1.5" style={{ color: 'var(--text-tertiary)' }}>{dates[tooltip.idx] ?? ''}</div>
          {series.map((s) => {
            const v = s.values[tooltip!.idx];
            return (
              <div key={s.label} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5" style={{ color: s.color }}>
                  <span
                    className="inline-block h-1.5 w-3 rounded-full"
                    style={{ background: s.dashed ? 'none' : s.color, borderTop: s.dashed ? `2px dashed ${s.color}` : undefined }}
                  />
                  {s.label}
                </span>
                <span className="font-medium tabular-nums" style={{ color: 'var(--text-primary)' }}>
                  {v != null && isFinite(v) ? yFormat(v) : '—'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
