import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  /** 'interactive' adds hover border brightening */
  variant?: 'default' | 'interactive';
  padding?: 'none' | 'sm' | 'md';
}

export function Card({
  children,
  className = '',
  variant = 'default',
  padding = 'md',
}: CardProps) {
  const base =
    'rounded-lg border bg-elevated';
  const borderClass =
    variant === 'interactive'
      ? 'border-[var(--border)] hover:border-[var(--border-strong)] transition-colors duration-[var(--duration)]'
      : 'border-[var(--border)]';
  const padClass =
    padding === 'none' ? '' : padding === 'sm' ? 'p-4' : 'p-6';

  return (
    <div className={`${base} ${borderClass} ${padClass} ${className}`}>
      {children}
    </div>
  );
}
