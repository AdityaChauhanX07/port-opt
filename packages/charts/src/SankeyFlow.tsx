'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SankeyFlowProps {
  beforeWeights: number[];
  afterWeights:  number[];
  tickers:       string[];
  beforeDate:    string;
  afterDate:     string;
  height?:       number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const M = { top: 16, right: 100, bottom: 16, left: 100 };
const NODE_W = 14;
const NODE_GAP = 3; // px between stacked nodes

const PALETTE = [
  '#5e8eff', '#3fb950', '#f59e0b', '#8b5cf6',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316',
  '#14b8a6', '#6366f1', '#d97706', '#a78bfa',
];

const GAIN_COLOR    = '#3fb950';
const LOSS_COLOR    = '#f85149';
const NEUTRAL_COLOR = '#8b949e';

const LABEL_COLOR   = 'var(--text-secondary)';
const TERTIARY      = 'var(--text-tertiary)';

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

/** Compute stacked node y-positions for one column. */
function layoutNodes(weights: number[], totalH: number) {
  const n = weights.length;
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const usable = totalH - NODE_GAP * (n - 1);
  const ys: Array<{ top: number; bot: number }> = [];
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const h = Math.max((weights[i] / sum) * usable, 1);
    ys.push({ top: cursor, bot: cursor + h });
    cursor += h + NODE_GAP;
  }
  return ys;
}

/** Cubic-bezier ribbon path between two rectangles. */
function ribbonPath(
  x0: number, y0t: number, y0b: number,
  x1: number, y1t: number, y1b: number,
) {
  const mx = (x0 + x1) / 2;
  return [
    `M ${x0} ${y0t}`,
    `C ${mx} ${y0t}, ${mx} ${y1t}, ${x1} ${y1t}`,
    `L ${x1} ${y1b}`,
    `C ${mx} ${y1b}, ${mx} ${y0b}, ${x0} ${y0b}`,
    'Z',
  ].join(' ');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SankeyFlow({
  beforeWeights,
  afterWeights,
  tickers,
  beforeDate,
  afterDate,
  height = 380,
}: SankeyFlowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef       = useRef<SVGSVGElement>(null);
  const [width, setWidth]         = useState(640);
  const [hoveredTicker, setHoveredTicker] = useState<string | null>(null);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.max(e.contentRect.width, 300));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const draw = useCallback(() => {
    if (!svgRef.current || tickers.length === 0) return;
    const n   = tickers.length;
    const iW  = width  - M.left - M.right;
    const iH  = height - M.top  - M.bottom;

    // Clamp weights to valid values
    const wBefore = beforeWeights.slice(0, n).map(w => Math.max(w, 0));
    const wAfter  = afterWeights.slice(0, n).map(w => Math.max(w, 0));

    const leftNodes  = layoutNodes(wBefore, iH);
    const rightNodes = layoutNodes(wAfter,  iH);

    const leftX  = 0;
    const rightX = iW;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g').attr('transform', `translate(${M.left},${M.top})`);

    // ── Column labels ──────────────────────────────────────────────────────
    const headerY = -10;
    g.append('text')
      .attr('x', leftX + NODE_W / 2).attr('y', headerY)
      .attr('text-anchor', 'middle')
      .attr('fill', TERTIARY).attr('font-size', 10)
      .text(beforeDate.slice(0, 10));

    g.append('text')
      .attr('x', rightX + NODE_W / 2).attr('y', headerY)
      .attr('text-anchor', 'middle')
      .attr('fill', TERTIARY).attr('font-size', 10)
      .text(afterDate.slice(0, 10));

    // ── Ribbons ────────────────────────────────────────────────────────────
    for (let i = 0; i < n; i++) {
      const ln = leftNodes[i];
      const rn = rightNodes[i];
      const dw = wAfter[i] - wBefore[i];
      const absDw = Math.abs(dw);

      const isHovered  = hoveredTicker === null || hoveredTicker === tickers[i];
      const fillColor  = absDw < 0.005 ? NEUTRAL_COLOR : dw > 0 ? GAIN_COLOR : LOSS_COLOR;
      const opacity    = isHovered ? 0.28 : 0.07;

      const path = ribbonPath(
        leftX + NODE_W, ln.top, ln.bot,
        rightX,         rn.top, rn.bot,
      );

      g.append('path')
        .attr('d', path)
        .attr('fill', fillColor)
        .attr('opacity', opacity)
        .attr('cursor', 'default')
        .style('transition', 'opacity 0.12s');
    }

    // ── Left nodes + labels ────────────────────────────────────────────────
    for (let i = 0; i < n; i++) {
      const { top, bot } = leftNodes[i];
      const h     = bot - top;
      const color = PALETTE[i % PALETTE.length];
      const active = hoveredTicker === null || hoveredTicker === tickers[i];
      const pct   = (wBefore[i] * 100).toFixed(1);

      // Node rect
      g.append('rect')
        .attr('x', leftX).attr('y', top)
        .attr('width', NODE_W).attr('height', h)
        .attr('fill', color)
        .attr('opacity', active ? 0.9 : 0.3)
        .attr('rx', 2)
        .style('transition', 'opacity 0.12s')
        .on('mouseenter', () => setHoveredTicker(tickers[i]))
        .on('mouseleave', () => setHoveredTicker(null));

      // Label
      if (h > 10) {
        g.append('text')
          .attr('x', leftX - 6).attr('y', (top + bot) / 2 + 4)
          .attr('text-anchor', 'end')
          .attr('fill', active ? LABEL_COLOR : TERTIARY)
          .attr('font-size', 11)
          .attr('font-family', 'var(--font-mono, monospace)')
          .style('transition', 'fill 0.12s')
          .text(`${tickers[i]}  ${pct}%`);
      }
    }

    // ── Right nodes + labels ───────────────────────────────────────────────
    for (let i = 0; i < n; i++) {
      const { top, bot } = rightNodes[i];
      const h     = bot - top;
      const color = PALETTE[i % PALETTE.length];
      const active = hoveredTicker === null || hoveredTicker === tickers[i];
      const dw    = wAfter[i] - wBefore[i];
      const pct   = (wAfter[i] * 100).toFixed(1);

      // Node rect — colour the border gain/loss if weight changed meaningfully
      g.append('rect')
        .attr('x', rightX).attr('y', top)
        .attr('width', NODE_W).attr('height', h)
        .attr('fill', color)
        .attr('opacity', active ? 0.9 : 0.3)
        .attr('rx', 2)
        .style('transition', 'opacity 0.12s')
        .on('mouseenter', () => setHoveredTicker(tickers[i]))
        .on('mouseleave', () => setHoveredTicker(null));

      // Δ indicator bar on the node's right edge
      if (Math.abs(dw) > 0.003) {
        const indicatorColor = dw > 0 ? GAIN_COLOR : LOSS_COLOR;
        const indicatorH = Math.max(Math.abs(dw) * (iH - NODE_GAP * (n - 1)), 2);
        g.append('rect')
          .attr('x', rightX + NODE_W).attr('y', (top + bot) / 2 - indicatorH / 2)
          .attr('width', 3).attr('height', indicatorH)
          .attr('fill', indicatorColor)
          .attr('rx', 1.5)
          .attr('opacity', active ? 0.8 : 0.2);
      }

      // Label
      if (h > 10) {
        const deltaStr = dw > 0.003
          ? `+${(dw * 100).toFixed(1)}%`
          : dw < -0.003
          ? `${(dw * 100).toFixed(1)}%`
          : '';

        const deltaColor = dw > 0.003 ? GAIN_COLOR : dw < -0.003 ? LOSS_COLOR : TERTIARY;

        const label = g.append('g')
          .attr('cursor', 'default')
          .on('mouseenter', () => setHoveredTicker(tickers[i]))
          .on('mouseleave', () => setHoveredTicker(null));

        label.append('text')
          .attr('x', rightX + NODE_W + 8).attr('y', (top + bot) / 2 + (deltaStr ? 0 : 4))
          .attr('fill', active ? LABEL_COLOR : TERTIARY)
          .attr('font-size', 11)
          .attr('font-family', 'var(--font-mono, monospace)')
          .style('transition', 'fill 0.12s')
          .text(`${tickers[i]}  ${pct}%`);

        if (deltaStr) {
          label.append('text')
            .attr('x', rightX + NODE_W + 8).attr('y', (top + bot) / 2 + 13)
            .attr('fill', active ? deltaColor : TERTIARY)
            .attr('font-size', 10)
            .attr('font-family', 'var(--font-mono, monospace)')
            .style('transition', 'fill 0.12s')
            .text(deltaStr);
        }
      }
    }
  }, [beforeWeights, afterWeights, tickers, beforeDate, afterDate, width, height, hoveredTicker]);

  useEffect(() => { draw(); }, [draw]);

  return (
    <div ref={containerRef} className="relative w-full" style={{ height }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="overflow-visible"
      />
    </div>
  );
}
