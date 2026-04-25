'use client';

export interface WeightBarProps {
  weights: number[];
  tickers: string[];
  longOnly?: boolean;
}

export function WeightBar({ weights, tickers, longOnly = true }: WeightBarProps) {
  const n = tickers.length;
  const paired = weights.map((w, i) => ({ w, ticker: tickers[i] ?? `A${i}` }));

  // Sort descending by weight
  const sorted = [...paired].sort((a, b) => b.w - a.w);

  // Explicit loop avoids Math.max spread edge-cases (NaN propagation, etc.)
  let maxAbsW = 0;
  for (const { w } of sorted) {
    const aw = Math.abs(w);
    if (aw > maxAbsW) maxAbsW = aw;
  }
  const scale = maxAbsW > 0 ? maxAbsW : 1; // fallback: all-zero → scale = 1

  const hasNegative = !longOnly && weights.some((w) => w < 0);

  // Concentration index (Herfindahl)
  const hhi = weights.reduce((s, w) => s + w * w, 0);
  const maxWPct = maxAbsW * 100;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {sorted.map(({ w, ticker }) => {
        const pct = w * 100;
        // Clamp to [0, 1] — no overflows, no NaN escaping into CSS
        const relFill = Math.min(Math.abs(w) / scale, 1);
        const isNeg = w < 0;

        return (
          <div
            key={ticker}
            style={{ display: 'flex', alignItems: 'center', gap: 10, height: 32 }}
          >
            {/* Ticker label */}
            <span
              style={{
                width: 48,
                flexShrink: 0,
                textAlign: 'right',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
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
                height: 16,
                background: 'var(--surface)',
                borderRadius: 3,
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              {hasNegative ? (
                <>
                  {/* Bar extends from center — positive right, negative left */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: isNeg ? `${((1 - relFill) * 50).toFixed(2)}%` : '50%',
                      width: `${(relFill * 50).toFixed(2)}%`,
                      background: isNeg ? '#EF4444' : '#3B82F6',
                      transition: 'left var(--duration-micro) var(--ease), width var(--duration-micro) var(--ease)',
                    }}
                  />
                  {/* Center zero divider */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: '50%',
                      width: 1,
                      background: 'var(--border)',
                    }}
                  />
                </>
              ) : (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    bottom: 0,
                    width: `${(relFill * 100).toFixed(2)}%`,
                    background: '#3B82F6',
                    transition: 'width var(--duration-micro) var(--ease)',
                  }}
                />
              )}
            </div>

            {/* Percentage */}
            <span
              style={{
                width: 44,
                flexShrink: 0,
                textAlign: 'right',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: isNeg ? '#EF4444' : 'var(--text-primary)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {pct.toFixed(1)}%
            </span>
          </div>
        );
      })}

      {/* Summary line */}
      {n > 0 && (
        <p
          style={{
            marginTop: 8,
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--text-tertiary)',
          }}
        >
          {n} assets · concentration index {hhi.toFixed(2)} · max weight {maxWPct.toFixed(1)}%
        </p>
      )}
    </div>
  );
}
