'use client';

import React, { useCallback } from 'react';
import * as RadixSelect from '@radix-ui/react-select';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder = 'Select…',
  disabled = false,
  className = '',
}: SelectProps) {
  const handleValueChange = useCallback(
    (v: string) => {
      if (v !== value) onValueChange(v);
    },
    [value, onValueChange],
  );

  return (
    <RadixSelect.Root value={value} onValueChange={handleValueChange} disabled={disabled}>
      <RadixSelect.Trigger
        className={[
          'inline-flex items-center justify-between gap-2',
          'h-9 px-3 rounded border border-[var(--border)] bg-[var(--bg)]',
          'text-[13px] text-primary',
          'outline-none transition-[border-color] duration-[var(--duration-micro)] ease-[var(--ease)]',
          'focus:border-[var(--border-strong)]',
          'data-[placeholder]:text-tertiary',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          'select-none cursor-default whitespace-nowrap',
          className,
        ].join(' ')}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon className="text-tertiary shrink-0">
          <ChevronDown size={12} />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          className={[
            'relative z-50 min-w-[8rem] overflow-hidden',
            'rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-elevated)]',
            'shadow-[0_4px_16px_rgba(0,0,0,0.4)]',
            'animate-in fade-in-0 zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          ].join(' ')}
          position="popper"
          sideOffset={4}
          style={{ animationDuration: 'var(--duration-micro)' }}
        >
          <RadixSelect.Viewport className="p-1">
            {options.map((opt) => (
              <RadixSelect.Item
                key={opt.value}
                value={opt.value}
                className={[
                  'relative flex items-center px-3 rounded cursor-default select-none outline-none',
                  'text-[13px] text-primary',
                  'h-8',
                  'data-[highlighted]:bg-[var(--surface-elevated)]',
                  'data-[state=checked]:bg-[var(--accent-dim)]',
                  'transition-colors duration-[var(--duration-micro)]',
                ].join(' ')}
              >
                <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

function ChevronDown({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
