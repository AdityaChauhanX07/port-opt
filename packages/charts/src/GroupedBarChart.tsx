'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GroupedBar {
  label: string;
  value: number;
  color?: string;
}

export interface BarGroup {
  group: string;
  bars:  GroupedBar[];
}

export interface GroupedBarChartProps {
  data:    BarGroup[];
  height?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const M = { top: 16, right: 24, bottom: 48, left: 64 };
const GAIN_COLOR = '#3fb950';
const LOSS_COLOR = '#f85149';
const COLORS = {
  grid:  'rgba(255,255,255,0.05)',
  axis:  '#525252',
  tick:  '#737373',
  label: '#a3a3a3',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GroupedBarChart({ data, height = 240 }: GroupedBarChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef       = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(640);
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; label: string; group: string; value: number;
  } | null>(null);

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
    if (!svgRef.current || data.length === 0) return;

    const iW = width  - M.left - M.right;
    const iH = height - M.top  - M.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g').attr('transform', `translate(${M.left},${M.top})`);

    // Compute series labels and y-extent
    const allBarsPerGroup = data[0].bars.length;
    const seriesLabels = data[0].bars.map((b) => b.label);

    const allValues = data.flatMap((g) => g.bars.map((b) => b.value));
    const [vMin = -0.3, vMax = 0.3] = d3.extent(allValues) as [number, number];
    const yPad = Math.max(Math.abs(vMax), Math.abs(vMin)) * 0.12;
    const yDomain: [number, number] = [
      Math.min(vMin - yPad, 0),
      Math.max(vMax + yPad, 0),
    ];

    // Scales
    const x0 = d3.scaleBand()
      .domain(data.map((d) => d.group))
      .range([0, iW])
      .padding(0.28);

    const x1 = d3.scaleBand()
      .domain(seriesLabels)
      .range([0, x0.bandwidth()])
      .padding(0.1);

    const y = d3.scaleLinear().domain(yDomain).range([iH, 0]);

    // Zero line
    const zeroY = y(0);
    g.append('line')
      .attr('x1', 0).attr('x2', iW)
      .attr('y1', zeroY).attr('y2', zeroY)
      .attr('stroke', 'rgba(255,255,255,0.12)')
      .attr('stroke-width', 1);

    // Grid lines
    g.append('g')
      .selectAll('line')
      .data(y.ticks(5).filter((t) => t !== 0))
      .join('line')
      .attr('x1', 0).attr('x2', iW)
      .attr('y1', (d) => y(d as number)).attr('y2', (d) => y(d as number))
      .attr('stroke', COLORS.grid)
      .attr('stroke-width', 1);

    // Axes
    const styleAxis = (sel: d3.Selection<SVGGElement, unknown, null, undefined>) => {
      sel.select('.domain').attr('stroke', COLORS.axis);
      sel.selectAll('.tick line').attr('stroke', COLORS.axis);
      sel.selectAll<SVGTextElement, unknown>('.tick text')
        .attr('fill', COLORS.tick).attr('font-size', 11);
    };

    g.append('g')
      .attr('transform', `translate(0,${iH})`)
      .call(d3.axisBottom(x0).tickSize(0))
      .call((sel) => {
        sel.select('.domain').remove();
        sel.selectAll('.tick text')
          .attr('fill', COLORS.label)
          .attr('font-size', 11)
          .attr('dy', '1.2em');
      });

    g.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat((d) => `${(+d * 100).toFixed(0)}%`))
      .call(styleAxis);

    // Bars
    for (const groupDatum of data) {
      const gx = x0(groupDatum.group) ?? 0;
      const grp = g.append('g').attr('transform', `translate(${gx},0)`);

      for (const bar of groupDatum.bars) {
        const bx   = x1(bar.label) ?? 0;
        const bw   = x1.bandwidth();
        const val  = bar.value;
        const fill = bar.color ?? (val >= 0 ? GAIN_COLOR : LOSS_COLOR);
        const barH = Math.abs(y(val) - zeroY);
        const barY = val >= 0 ? zeroY - barH : zeroY;

        grp.append('rect')
          .attr('x', bx).attr('y', barY)
          .attr('width', bw).attr('height', Math.max(barH, 1))
          .attr('fill', fill)
          .attr('opacity', 0.8)
          .attr('rx', 2)
          .on('mouseenter', function (event) {
            const [cx, cy] = d3.pointer(event, containerRef.current!);
            setTooltip({
              x: cx, y: cy,
              label: bar.label,
              group: groupDatum.group,
              value: val,
            });
          })
          .on('mouseleave', () => setTooltip(null));
      }
    }

    // Legend (top-right of chart area)
    if (allBarsPerGroup > 1) {
      const legend = g.append('g')
        .attr('transform', `translate(${iW - 10}, 0)`);

      seriesLabels.forEach((label, i) => {
        const refVal = data[0].bars[i]?.value ?? 0;
        const color  = data[0].bars[i]?.color ?? (refVal >= 0 ? GAIN_COLOR : LOSS_COLOR);
        legend.append('rect')
          .attr('x', 0).attr('y', i * 16)
          .attr('width', 9).attr('height', 9)
          .attr('fill', color).attr('rx', 2);
        legend.append('text')
          .attr('x', 13).attr('y', i * 16 + 8)
          .attr('fill', COLORS.label).attr('font-size', 11)
          .text(label);
      });
    }
  }, [data, width, height]);

  useEffect(() => { draw(); }, [draw]);

  const tooltipRight = tooltip && tooltip.x > width * 0.6;

  return (
    <div ref={containerRef} className="relative w-full" style={{ height }}>
      <svg ref={svgRef} width={width} height={height} className="overflow-visible" />

      {tooltip && (
        <div
          className="absolute pointer-events-none z-20 rounded border text-xs shadow-lg"
          style={{
            left: tooltipRight ? tooltip.x - 148 : tooltip.x + 12,
            top:  Math.max(8, tooltip.y - 24),
            minWidth: 140,
            background: '#111111',
            borderColor: 'rgba(255,255,255,0.08)',
            padding: '8px 10px',
          }}
        >
          <div className="mb-1 text-[#737373]">{tooltip.group}</div>
          <div className="flex justify-between gap-4">
            <span className="text-[#a3a3a3]">{tooltip.label}</span>
            <span
              className="tabular-nums font-medium"
              style={{ color: tooltip.value >= 0 ? GAIN_COLOR : LOSS_COLOR }}
            >
              {tooltip.value >= 0 ? '+' : ''}{(tooltip.value * 100).toFixed(2)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
