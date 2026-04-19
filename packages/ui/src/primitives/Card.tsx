import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'interactive' | 'inset';
  padding?: 'none' | 'sm' | 'md';
}

export function Card({
  children,
  className = '',
  variant = 'default',
  padding = 'md',
}: CardProps) {
  const base = 'rounded-[var(--radius-md)]';

  const variantClass =
    variant === 'inset'
      ? 'bg-[var(--bg-inset)]'
      : variant === 'interactive'
        ? 'bg-[var(--surface)] border border-[var(--border-subtle)] hover:border-[var(--border)] transition-colors duration-[var(--duration-micro)] cursor-pointer'
        : 'bg-[var(--surface)] border border-[var(--border-subtle)]';

  const padClass =
    padding === 'none' ? '' : padding === 'sm' ? 'p-4' : 'p-6';

  return (
    <div className={`${base} ${variantClass} ${padClass} ${className}`}>
      {children}
    </div>
  );
}
