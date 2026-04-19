'use client';

import React from 'react';
import * as RadixSwitch from '@radix-ui/react-switch';

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  id?: string;
}

export function Switch({ checked, onCheckedChange, disabled, label, id }: SwitchProps) {
  return (
    <div className="flex items-center gap-2">
      <RadixSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        style={{ width: 32, height: 18 }}
        className={[
          'relative inline-flex shrink-0 cursor-pointer items-center rounded-full',
          'transition-colors duration-[var(--duration-micro)] ease-[var(--ease)]',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          'data-[state=unchecked]:bg-[var(--border-subtle)]',
          'data-[state=checked]:bg-accent',
        ].join(' ')}
      >
        <RadixSwitch.Thumb
          style={{ width: 12, height: 12 }}
          className={[
            'block rounded-full',
            'transition-[transform,background-color] duration-[var(--duration-micro)] ease-[var(--ease)]',
            'data-[state=unchecked]:translate-x-[3px] data-[state=unchecked]:bg-tertiary',
            'data-[state=checked]:translate-x-[17px] data-[state=checked]:bg-white',
          ].join(' ')}
        />
      </RadixSwitch.Root>
      {label && (
        <label
          htmlFor={id}
          className="text-[13px] text-secondary cursor-pointer select-none"
        >
          {label}
        </label>
      )}
    </div>
  );
}
