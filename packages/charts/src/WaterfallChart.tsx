'use client';

import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WaterfallBar {
  label: string;
  value: number;   // fraction [0,1]
  color: string;
}

export interface WaterfallChartProps {
  /** Each bar except the first represents an additive component. */
  bars: WaterfallBar[];
  height?: number;
  /** If true, show a Total bar on the left (value=1). */
  showTotal?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const M = { top: 20, right: 16, bottom: 64, left: 48 };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WaterfallChart({ bars, height = 240, showTotal = true }: WaterfallChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    const container = containerRef.current;
    if (!svg || !container || !bars.length) return;

    const W = container.getBoundingClientRect().width || 600;
    const H = height;
    const innerW = W - M.left - M.right;
    const innerH = H - M.top - M.bottom;

    d3.select(svg).selectAll('*').remove();
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    const root = d3.select(svg).append('g').attr('transform', `translate(${M.left},${M.top})`);

    // Build data with waterfall offsets
    type Bar = { label: string; value: number; start: number; end: number; color: string; isTotal: boolean };
    const data: Bar[] = [];

    if (showTotal) {
      data.push({ label: 'Total', value: 1, start: 0, end: 1, color: '#484848', isTotal: true });
    }

    let cumulative = 0;
    for (const bar of bars) {
      const start = cumulative;
      const end = cumulative + bar.value;
      data.push({ label: bar.label, value: bar.value, start, end, color: bar.color, isTotal: false });
      cumulative = end;
    }

    // Scales
    const xScale = d3
      .scaleBand()
      .domain(data.map((d) => d.label))
      .range([0, innerW])
      .paddingInner(0.25)
      .paddingOuter(0.1);

    const yMax = Math.max(...data.map((d) => d.end), 1.0);
    const yScale = d3.scaleLinear().domain([0, yMax]).range([innerH, 0]);

    // Grid lines
    root
      .append('g')
      .selectAll('line')
      .data(yScale.ticks(5))
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', 'var(--border-subtle)')
      .attr('stroke-width', 1);

    // Connector lines (between waterfall bars, not to total)
    for (let i = showTotal ? 1 : 0; i < data.length - 1; i++) {
      const curr = data[i];
      const next = data[i + 1];
      if (curr.isTotal || next.isTotal) continue;
      const x1 = (xScale(curr.label) ?? 0) + xScale.bandwidth();
      const x2 = xScale(next.label) ?? 0;
      const y = yScale(curr.end);
      root
        .append('line')
        .attr('x1', x1)
        .attr('x2', x2)
        .attr('y1', y)
        .attr('y2', y)
        .attr('stroke', 'var(--border)')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '3 3');
    }

    // Bars
    root
      .selectAll('.bar')
      .data(data)
      .join('rect')
      .attr('class', 'bar')
      .attr('x', (d) => xScale(d.label) ?? 0)
      .attr('y', (d) => yScale(d.end))
      .attr('width', xScale.bandwidth())
      .attr('height', (d) => Math.max(1, yScale(d.start) - yScale(d.end)))
      .attr('fill', (d) => d.color)
      .attr('opacity', (d) => (d.isTotal ? 0.3 : 0.85))
      .attr('rx', 2);

    // Value labels inside / above bars
    root
      .selectAll('.val-label')
      .data(data)
      .join('text')
      .attr('class', 'val-label')
      .attr('x', (d) => (xScale(d.label) ?? 0) + xScale.bandwidth() / 2)
      .attr('y', (d) => {
        const barH = yScale(d.start) - yScale(d.end);
        return barH > 18
          ? yScale(d.end) + barH / 2 + 4  // inside
          : yScale(d.end) - 4;             // above
      })
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--text-primary)')
      .attr('font-size', '10px')
      .attr('font-family', 'monospace')
      .text((d) => `${(d.value * 100).toFixed(1)}%`);

    // X axis labels
    root
      .append('g')
      .attr('transform', `translate(0,${innerH})`)
      .selectAll('text')
      .data(data)
      .join('text')
      .attr('x', (d) => (xScale(d.label) ?? 0) + xScale.bandwidth() / 2)
      .attr('y', 14)
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--text-tertiary)')
      .attr('font-size', '10px')
      .text((d) => d.label)
      .call((sel) => {
        // Rotate labels if they're likely to overlap
        if (data.length > 5) {
          sel
            .attr('transform', (d) => {
              const cx = (xScale(d.label) ?? 0) + xScale.bandwidth() / 2;
              return `rotate(-35,${cx},${innerH + 14})`;
            })
            .attr('text-anchor', 'end');
        }
      });

    // Y axis
    root
      .append('g')
      .call(
        d3.axisLeft(yScale)
          .ticks(5)
          .tickSize(0)
          .tickFormat((d) => `${((d as number) * 100).toFixed(0)}%`)
      )
      .call((g) => g.select('.domain').remove())
      .call((g) =>
        g.selectAll('text').attr('fill', '#6b6b6b').attr('font-size', '10px').attr('dx', '-0.3em')
      );
  }, [bars, height, showTotal]);

  // ResizeObserver for responsiveness
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const svg = svgRef.current;
      if (svg) svg.dispatchEvent(new Event('resize-internal'));
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
