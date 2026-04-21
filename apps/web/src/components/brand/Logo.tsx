import React from 'react';

interface LogoProps {
  /** Height of the mark in px. Wordmark scales proportionally. */
  size?: number;
  /** Show the "portopt" wordmark next to the mark. */
  showWordmark?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * PortOpt brand mark + wordmark lockup.
 *
 * Uses currentColor so the entire logo inherits its color from the parent.
 * Set a text-color on the wrapper to tint the logo.
 *
 * Mark geometry:
 *   Frontier curve: M 4,26 Q 10,6 30,4  (quadratic Bézier, viewBox 0 0 32 32)
 *   Max Sharpe dot: (14, 10) — calculated intersection at t≈0.519 on the curve
 */
export function Logo({ size = 32, showWordmark = true, className, style }: LogoProps) {
  const fontSize  = Math.round((22 / 32) * size);
  const gap       = Math.round(0.4 * size);
  // Nudge wordmark up slightly so its x-height aligns with the mark's optical center.
  const nudge     = Math.max(1, Math.round(size * 0.04));

  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap,
        ...style,
      }}
    >
      {/* ── Mark ── */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden={showWordmark}
        role={showWordmark ? undefined : 'img'}
        aria-label={showWordmark ? undefined : 'PortOpt'}
        style={{ flexShrink: 0, display: 'block' }}
      >
        {/* Efficient frontier curve */}
        <path
          d="M 4,26 Q 10,6 30,4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />

        {/* Max Sharpe outer ring */}
        <circle
          cx="14"
          cy="10"
          r="4.5"
          stroke="currentColor"
          strokeWidth="1"
          strokeOpacity="0.3"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />

        {/* Max Sharpe filled dot */}
        <circle
          cx="14"
          cy="10"
          r="2.5"
          fill="currentColor"
        />
      </svg>

      {/* ── Wordmark ── */}
      {showWordmark && (
        <span
          aria-label="PortOpt"
          style={{
            fontFamily: 'var(--font-sans, Inter, system-ui, sans-serif)',
            fontSize,
            fontWeight: 500,
            letterSpacing: '-0.015em',
            lineHeight: 1,
            marginBottom: nudge,
            userSelect: 'none',
          }}
        >
          portopt
        </span>
      )}
    </div>
  );
}
