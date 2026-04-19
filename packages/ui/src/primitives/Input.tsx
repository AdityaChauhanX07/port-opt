import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: 'default' | 'mono';
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { variant = 'default', className = '', ...props },
  ref,
) {
  const monoClass =
    variant === 'mono' || props.type === 'number'
      ? 'font-mono [font-variant-numeric:tabular-nums]'
      : '';

  return (
    <input
      ref={ref}
      className={[
        'h-9 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-3',
        'text-[13px] text-primary placeholder:text-tertiary',
        'outline-none transition-[border-color] duration-[var(--duration-micro)] ease-[var(--ease)]',
        'focus:border-[var(--border-strong)]',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        monoClass,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  );
});
