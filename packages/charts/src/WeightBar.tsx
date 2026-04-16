'use client';

// ---------------------------------------------------------------------------
// WeightBar — horizontal bar chart for portfolio weight allocation.
//
// Uses CSS transitions (transition-[width]) so framer-motion is not required
// in this package. Bars animate smoothly when weights change.
// ---------------------------------------------------------------------------

const PALETTE = [
  '#2f81f7', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#84cc16', // lime
  '#f97316', // orange
  '#6366f1', // indigo
  '#14b8a6', // teal
  '#d97706', // yellow-600
];

export interface WeightBarProps {
  weights: number[];
  tickers: string[];
}

export function WeightBar({ weights, tickers }: WeightBarProps) {
  return (
    <div className="space-y-2.5">
      {tickers.map((ticker, i) => {
        const pct  = Math.max(0, (weights[i] ?? 0) * 100);
        const color = PALETTE[i % PALETTE.length];

        return (
          <div key={ticker} className="flex items-center gap-3">
            {/* Ticker label */}
            <span className="w-12 shrink-0 text-right text-xs font-medium text-[#888]">
              {ticker}
            </span>

            {/* Bar track */}
            <div className="relative flex-1 h-6 overflow-hidden rounded bg-[#1a1a1a]">
              {/* Fill */}
              <div
                className="absolute inset-y-0 left-0 flex items-center rounded transition-[width] duration-500 ease-out"
                style={{ width: `${pct}%`, backgroundColor: color }}
              >
                {pct > 4 && (
                  <span className="pl-2 text-[11px] font-semibold text-white/90 leading-none">
                    {pct.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>

            {/* Numeric label */}
            <span className="w-14 shrink-0 text-right text-xs tabular-nums text-[#e5e5e5]">
              {pct.toFixed(1)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
