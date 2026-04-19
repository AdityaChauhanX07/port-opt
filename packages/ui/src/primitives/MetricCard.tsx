import React from 'react';

interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  color?: 'positive' | 'negative' | 'warning';
}

export function MetricCard({ label, value, sub, color }: MetricCardProps) {
  const valueColor =
    color === 'positive' ? 'var(--positive)' :
    color === 'negative' ? 'var(--negative)' :
    color === 'warning'  ? 'var(--warning)'  :
    'var(--text-primary)';

  return (
    <div className="flex flex-col gap-1">
      <span
        className="text-[11px] font-medium uppercase tracking-[0.08em]"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {label}
      </span>
      <span
        className="text-[24px] leading-[32px] font-medium [font-variant-numeric:tabular-nums]"
        style={{ fontFamily: 'var(--font-mono)', color: valueColor }}
      >
        {value}
      </span>
      {sub && (
        <span
          className="text-[12px] leading-[16px]"
          style={{ color: 'var(--text-secondary)' }}
        >
          {sub}
        </span>
      )}
    </div>
  );
}
