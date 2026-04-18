'use client';

import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegimeTimelineProps {
  /** Portfolio daily returns, length T. */
  returns: number[];
  /** Equity curve (cumulative, starting at 1), length T+1. */
  equity: number[];
  /** Viterbi state sequence, length T (indices 0..K-1). */
  stateSequence: number[];
  /** Date strings, length T (for returns) or T+1 (for equity). */
  dates: string[];
  /** Number of regimes. */
  nRegimes: number;
  height?: number;
}

// ---------------------------------------------------------------------------
// Regime colour palette (bear=red, neutral=yellow, bull=green, extra=blue)
// ---------------------------------------------------------------------------

const REGIME_COLORS = [
  '#f85149', // 0: bear
  '#e3b341', // 1: neutral
  '#3fb950', // 2: bull
  '#5e8eff', // 3: extra
];

const REGIME_LABELS = ['Bear', 'Neutral', 'Bull', 'Regime 4'];

const M = { top: 16, right: 24, bottom: 36, left: 56 };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface RegimeTimelineProps {
  returns: number[];
  equity: number[];
  stateSequence: number[];
  dates: string[];
  nRegimes: number;
  height?: number;
}

export function RegimeTimeline({
  returns,
  equity,
  stateSequence,
  dates,
  nRegimes,
  height = 220,
}: RegimeTimelineProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    const container = containerRef.current;
    if (!svg || !container) return;
    if (!equity.length || !stateSequence.length) return;

    const W = container.getBoundingClientRect().width || 600;
    const H = height;
    const innerW = W - M.left - M.right;
    const innerH = H - M.top - M.bottom;

    d3.select(svg).selectAll('*').remove();
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    const root = d3
      .select(svg)
      .append('g')
      .attr('transform', `translate(${M.left},${M.top})`);

    // Use equity dates (T+1) or returns dates (T)
    const equityDates = dates.length === equity.length
      ? dates
      : [dates[0], ...dates].slice(0, equity.length);

    // X scale: one point per equity step
    const xDates = equityDates.map((d) => new Date(d));
    const xScale = d3
      .scaleTime()
      .domain([xDates[0], xDates[xDates.length - 1]])
      .range([0, innerW]);

    // Y scale: equity values
    const yMin = d3.min(equity) ?? 0;
    const yMax = d3.max(equity) ?? 2;
    const yPad = (yMax - yMin) * 0.05;
    const yScale = d3
      .scaleLinear()
      .domain([yMin - yPad, yMax + yPad])
      .range([innerH, 0]);

    // ---- Regime background bands ----
    // Build contiguous segments from stateSequence (length T maps to returns)
    type Segment = { state: number; t0: number; t1: number };
    const segments: Segment[] = [];
    if (stateSequence.length > 0) {
      let seg: Segment = { state: stateSequence[0], t0: 0, t1: 0 };
      for (let i = 1; i < stateSequence.length; i++) {
        if (stateSequence[i] !== seg.state) {
          seg.t1 = i;
          segments.push(seg);
          seg = { state: stateSequence[i], t0: i, t1: i };
        }
      }
      seg.t1 = stateSequence.length;
      segments.push(seg);
    }

    // Map segment index t to equity date index (t → t+1 for equity start)
    const tToDate = (t: number) => xDates[Math.min(t, xDates.length - 1)];

    for (const seg of segments) {
      const x0 = xScale(tToDate(seg.t0));
      const x1 = xScale(tToDate(seg.t1));
      root
        .append('rect')
        .attr('x', x0)
        .attr('y', 0)
        .attr('width', x1 - x0)
        .attr('height', innerH)
        .attr('fill', REGIME_COLORS[seg.state % REGIME_COLORS.length])
        .attr('opacity', 0.12);
    }

    // ---- Grid lines ----
    const yTicks = yScale.ticks(4);
    root
      .append('g')
      .attr('class', 'grid')
      .selectAll('line')
      .data(yTicks)
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', '#2a2a2a')
      .attr('stroke-width', 1);

    // ---- Equity line ----
    const equityData = equity.map((v, i) => ({ date: xDates[i], value: v }));
    const line = d3
      .line<{ date: Date; value: number }>()
      .x((d) => xScale(d.date))
      .y((d) => yScale(d.value))
      .defined((d) => isFinite(d.value))
      .curve(d3.curveMonotoneX);

    root
      .append('path')
      .datum(equityData)
      .attr('fill', 'none')
      .attr('stroke', '#5e8eff')
      .attr('stroke-width', 1.5)
      .attr('d', line);

    // ---- Axes ----
    const xAxis = d3
      .axisBottom(xScale)
      .ticks(5)
      .tickSize(0)
      .tickFormat((d) => d3.timeFormat('%b %Y')(d as Date));
    root
      .append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis)
      .call((g) => g.select('.domain').remove())
      .call((g) =>
        g.selectAll('text').attr('fill', '#6b6b6b').attr('font-size', '10px').attr('dy', '1.2em'),
      );

    const yAxis = d3
      .axisLeft(yScale)
      .ticks(4)
      .tickSize(0)
      .tickFormat((d) => `${(d as number).toFixed(2)}×`);
    root
      .append('g')
      .call(yAxis)
      .call((g) => g.select('.domain').remove())
      .call((g) =>
        g.selectAll('text').attr('fill', '#6b6b6b').attr('font-size', '10px').attr('dx', '-0.4em'),
      );

    // ---- Legend ----
    const legendG = root.append('g').attr('transform', `translate(${innerW - 4},4)`);
    for (let k = 0; k < nRegimes; k++) {
      const lg = legendG.append('g').attr('transform', `translate(0,${k * 16})`);
      lg.append('rect')
        .attr('x', -60)
        .attr('width', 10)
        .attr('height', 10)
        .attr('rx', 2)
        .attr('fill', REGIME_COLORS[k % REGIME_COLORS.length])
        .attr('opacity', 0.7);
      lg.append('text')
        .attr('x', -46)
        .attr('y', 9)
        .attr('fill', '#8b949e')
        .attr('font-size', '10px')
        .text(REGIME_LABELS[k] ?? `State ${k}`);
    }
  }, [equity, stateSequence, dates, nRegimes, height]);

  // ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // Re-trigger the draw effect by forcing a synthetic DOM event
      // (we do this via a tiny trick: just call the draw manually via ref)
      const svg = svgRef.current;
      if (!svg) return;
      // Trigger redraw — we'll get the latest sizes via getBoundingClientRect
      const event = new Event('resize-internal');
      svg.dispatchEvent(event);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="w-full">
      <svg ref={svgRef} className="w-full overflow-visible" />
    </div>
  );
}
