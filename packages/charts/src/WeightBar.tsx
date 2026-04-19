'use client';

export interface WeightBarProps {
  weights: number[];
  tickers: string[];
}

export function WeightBar({ weights, tickers }: WeightBarProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {tickers.map((ticker, i) => {
        const pct = Math.max(0, (weights[i] ?? 0) * 100);
        return (
          <div key={ticker} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Ticker label */}
            <span
              style={{
                width: 48,
                flexShrink: 0,
                textAlign: 'right',
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                color: 'var(--text-secondary)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {ticker}
            </span>

            {/* Bar track */}
            <div
              style={{
                flex: 1,
                height: 24,
                background: 'var(--surface)',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              {/* Fill */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  bottom: 0,
                  width: `${pct}%`,
                  background: 'var(--accent)',
                  borderRadius: 'var(--radius-sm)',
                  transition: 'width var(--duration-micro) var(--ease)',
                }}
              />
            </div>

            {/* Percentage */}
            <span
              style={{
                width: 44,
                flexShrink: 0,
                textAlign: 'right',
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                color: 'var(--text-primary)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {pct.toFixed(1)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
