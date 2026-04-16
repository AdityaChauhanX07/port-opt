import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: 'default' | 'mono';
}

export function Input({
  variant = 'default',
  className = '',
  ...props
}: InputProps) {
  const monoClass =
    variant === 'mono' || props.type === 'number'
      ? 'font-mono font-[var(--font-mono)] [font-variant-numeric:tabular-nums]'
      : '';

  return (
    <input
      className={[
        'h-8 w-full rounded bg-elevated border border-[var(--border)] px-3',
        'text-[13px] text-primary placeholder:text-muted',
        'outline-none transition-[border-color] duration-[var(--duration)]',
        'focus:border-[var(--border-focus)]',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        monoClass,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  );
}
