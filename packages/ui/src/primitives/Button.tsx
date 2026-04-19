import React from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variantStyles: Record<Variant, string> = {
  primary:
    'bg-accent text-white hover:bg-[var(--accent-hover)] border border-transparent',
  secondary:
    'bg-transparent border border-[var(--border)] text-primary hover:bg-[var(--surface-elevated)]',
  ghost:
    'bg-transparent border border-transparent text-secondary hover:text-primary hover:bg-[var(--surface-elevated)]',
};

const sizeStyles: Record<Size, string> = {
  sm: 'h-7 px-3 text-[13px] gap-1.5',
  md: 'h-9 px-3.5 text-[13px] gap-2',
  lg: 'h-10 px-5 text-[13px] gap-2',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps) {
  const base = [
    'inline-flex items-center justify-center font-medium rounded select-none whitespace-nowrap',
    'transition-[background-color,border-color,transform]',
    'duration-[var(--duration-micro)] ease-[var(--ease)]',
    'active:scale-[0.98]',
    'disabled:opacity-40 disabled:pointer-events-none',
    loading ? 'animate-pulse' : '',
  ].filter(Boolean).join(' ');

  return (
    <button
      disabled={disabled || loading}
      className={`${base} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {loading ? (
        <>
          <Spinner size={size === 'sm' ? 12 : 14} />
          {children}
        </>
      ) : (
        children
      )}
    </button>
  );
}

function Spinner({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin shrink-0"
    >
      <circle
        cx="12" cy="12" r="10"
        stroke="currentColor" strokeWidth="3" strokeOpacity="0.25"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor" strokeWidth="3" strokeLinecap="round"
      />
    </svg>
  );
}
