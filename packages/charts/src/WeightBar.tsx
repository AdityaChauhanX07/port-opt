'use client';

import { motion } from 'framer-motion';

const PALETTE = [
  '#2f81f7',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#6366f1',
  '#14b8a6',
  '#d97706',
];

const SPRING = { duration: 0.12, ease: [0.16, 1, 0.3, 1] as const };

export interface WeightBarProps {
  weights: number[];
  tickers: string[];
}

export function WeightBar({ weights, tickers }: WeightBarProps) {
  return (
    <div className="space-y-2.5">
      {tickers.map((ticker, i) => {
        const pct   = Math.max(0, (weights[i] ?? 0) * 100);
        const color = PALETTE[i % PALETTE.length];

        return (
          <div key={ticker} className="flex items-center gap-3">
            <span className="w-12 shrink-0 text-right text-xs font-medium text-[#888]">
              {ticker}
            </span>

            <div className="relative flex-1 h-6 overflow-hidden rounded bg-[#1a1a1a]">
              <motion.div
                className="absolute inset-y-0 left-0 flex items-center rounded"
                style={{ backgroundColor: color }}
                animate={{ width: `${pct}%` }}
                transition={SPRING}
              >
                {pct > 4 && (
                  <span className="pl-2 text-[11px] font-semibold text-white/90 leading-none">
                    {pct.toFixed(1)}%
                  </span>
                )}
              </motion.div>
            </div>

            <span className="w-14 shrink-0 text-right text-xs tabular-nums text-[#e5e5e5]">
              {pct.toFixed(1)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
