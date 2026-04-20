'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MonteCarloFanProps {
  /** Annualised drift (from portfolio log-returns × ppy). */
  muAnnual: number;
  /** Annualised volatility. */
  volAnnual: number;
  /** Periods per year (252/52/12). */
  ppy: number;
  /** Simulation horizon in years. */
  years: number;
  height?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const M = { top: 16, right: 24, bottom: 36, left: 60 };

// Standard normal quantiles for GBM percentile bands
const Z = { p05: -1.6449, p25: -0.6745, p75: 0.6745, p95: 1.6449 };

const COL = {
  outer:         'rgba(59,130,246,0.10)',  // 5-95 band — accent at low opacity, works both themes
  inner:         'rgba(59,130,246,0.22)',  // 25-75 band
  median:        'var(--accent)',
  breakeven:     'var(--border)',
  grid:          'var(--border-subtle)',
  axis:          'var(--border)',
  tick:          'var(--text-tertiary)',
  tooltip:       'var(--surface-elevated)',
  tooltipBorder: 'var(--border)',
};

// ---------------------------------------------------------------------------
// Analytical GBM band computation
// ---------------------------------------------------------------------------

interface FanData {
  t: number;    // time step index
  p05: number;
  p25: number;
  med: number;
  p75: number;
  p95: number;
}

function buildFanData(muAnnual: number, volAnnual: number, ppy: number, years: number): FanData[] {
  const nSteps = Math.round(years * ppy);
  if (nSteps < 1) return [];

  // Per-period log-space drift and volatility
  const driftStep = muAnnual / ppy - 0.5 * (volAnnual * volAnnual) / ppy;
  const sigmaStep = volAnnual / Math.sqrt(ppy);

  const data: FanData[] = [{ t: 0, p05: 1, p25: 1, med: 1, p75: 1, p95: 1 }];
  for (let t = 1; t <= nSteps; t++) {
    const logDrift = driftStep * t;
    const logSpread = sigmaStep * Math.sqrt(t);
    data.push({
      t,
      p05: Math.exp(logDrift + logSpread * Z.p05),
      p25: Math.exp(logDrift + logSpread * Z.p25),
      med: Math.exp(logDrift),
      p75: Math.exp(logDrift + logSpread * Z.p75),
      p95: Math.exp(logDrift + logSpread * Z.p95),
    });
  }
  return data;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MonteCarloFan({
  muAnnual,
  volAnnual,
  ppy,
  years,
  height = 280,
}: MonteCarloFanProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(640);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; t: number; med: number; p05: number; p95: number } | null>(null);

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
    if (!svgRef.current) return;

    const fanData = buildFanData(muAnnual, volAnnual, ppy, years);
    if (fanData.length < 2) return;

    const iW = width - M.left - M.right;
    const iH = height - M.top - M.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g').attr('transform', `translate(${M.left},${M.top})`);

    const nSteps = fanData.length - 1;

    // Scales
    const allY = fanData.flatMap((d) => [d.p05, d.p95]);
    const [yMin = 0, yMax = 2] = d3.extent(allY) as [number, number];
    const yPad = (yMax - yMin) * 0.04;

    const x = d3.scaleLinear().domain([0, nSteps]).range([0, iW]);
    const y = d3.scaleLinear().domain([yMin - yPad, yMax + yPad]).range([iH, 0]);

    // Grid
    g.append('g')
      .selectAll('line')
      .data(y.ticks(6))
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

    const xTickCount = Math.min(6, nSteps);
    g.append('g')
      .attr('transform', `translate(0,${iH})`)
      .call(
        d3.axisBottom(x)
          .ticks(xTickCount)
          .tickFormat((d) => {
            const yr = (+d) / ppy;
            return yr % 1 === 0 ? `${yr}y` : `${yr.toFixed(1)}y`;
          })
      )
      .call(styleAxis);

    g.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat((d) => `${(+d).toFixed(1)}×`))
      .call(styleAxis);

    // Break-even reference at 1.0
    const beY = y(1);
    if (beY >= 0 && beY <= iH) {
      g.append('line')
        .attr('x1', 0).attr('x2', iW)
        .attr('y1', beY).attr('y2', beY)
        .attr('stroke', COL.breakeven)
        .attr('stroke-dasharray', '4 4')
        .attr('stroke-width', 1);
    }

    // Outer band 5-95
    const areaOuter = d3.area<FanData>()
      .x((d) => x(d.t))
      .y0((d) => y(d.p05))
      .y1((d) => y(d.p95))
      .curve(d3.curveBasis);

    g.append('path')
      .datum(fanData)
      .attr('fill', COL.outer)
      .attr('d', areaOuter);

    // Inner band 25-75
    const areaInner = d3.area<FanData>()
      .x((d) => x(d.t))
      .y0((d) => y(d.p25))
      .y1((d) => y(d.p75))
      .curve(d3.curveBasis);

    g.append('path')
      .datum(fanData)
      .attr('fill', COL.inner)
      .attr('d', areaInner);

    // Median line
    const lineMed = d3.line<FanData>()
      .x((d) => x(d.t))
      .y((d) => y(d.med))
      .curve(d3.curveBasis);

    g.append('path')
      .datum(fanData)
      .attr('fill', 'none')
      .attr('stroke', COL.median)
      .attr('stroke-width', 1.5)
      .attr('d', lineMed);

    // Invisible overlay for hover
    g.append('rect')
      .attr('width', iW).attr('height', iH)
      .attr('fill', 'transparent')
      .on('mousemove', function (event) {
        const [mx] = d3.pointer(event);
        const tIdx = Math.round(x.invert(mx));
        const clamped = Math.max(0, Math.min(tIdx, nSteps));
        const d = fanData[clamped];
        if (!d) return;
        const [cx, cy] = d3.pointer(event, containerRef.current!);
        setTooltip({ x: cx, y: cy, t: clamped, med: d.med, p05: d.p05, p95: d.p95 });
      })
      .on('mouseleave', () => setTooltip(null));
  }, [muAnnual, volAnnual, ppy, years, width, height]);

  useEffect(() => { draw(); }, [draw]);

  const tooltipRight = tooltip && tooltip.x > width * 0.6;

  return (
    <div ref={containerRef} className="relative w-full" style={{ height }}>
      <svg ref={svgRef} width={width} height={height} className="overflow-visible" />

      {tooltip && (
        <div
          className="absolute pointer-events-none z-20 rounded border text-xs shadow-lg"
          style={{
            left: tooltipRight ? tooltip.x - 160 : tooltip.x + 12,
            top: Math.max(8, tooltip.y - 32),
            minWidth: 152,
            background: COL.tooltip,
            borderColor: COL.tooltipBorder,
            padding: '8px 10px',
          }}
        >
          <div className="mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
            t = {(tooltip.t / ppy).toFixed(2)}y ({tooltip.t} periods)
          </div>
          <div className="flex justify-between gap-4" style={{ color: 'var(--text-secondary)' }}>
            <span>p95</span>
            <span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{tooltip.p95.toFixed(3)}×</span>
          </div>
          <div className="flex justify-between gap-4">
            <span style={{ color: 'var(--accent)' }}>median</span>
            <span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{tooltip.med.toFixed(3)}×</span>
          </div>
          <div className="flex justify-between gap-4" style={{ color: 'var(--text-secondary)' }}>
            <span>p05</span>
            <span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{tooltip.p05.toFixed(3)}×</span>
          </div>
        </div>
      )}
    </div>
  );
}
