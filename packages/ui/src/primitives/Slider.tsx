'use client';

import React, { useCallback } from 'react';
import * as RadixSlider from '@radix-ui/react-slider';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: SliderProps) {
  const displayValue = format ? format(value) : String(value);

  // Equality guard: prevents infinite re-render loop from Radix floating-point
  // snap on controlled value during initial mount.
  const handleValueChange = useCallback(
    (vals: number[]) => {
      const newVal = vals[0];
      if (newVal !== undefined && newVal !== value) {
        onChange(newVal);
      }
    },
    [value, onChange],
  );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-tertiary">{label}</span>
        <span
          className="text-[13px] text-primary"
          style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
        >
          {displayValue}
        </span>
      </div>

      <RadixSlider.Root
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={handleValueChange}
        className="relative flex items-center select-none touch-none w-full h-5"
      >
        <RadixSlider.Track
          className="relative rounded-full w-full grow overflow-hidden"
          style={{ height: 2, background: 'var(--border-subtle)' }}
        >
          <RadixSlider.Range
            className="absolute h-full rounded-full"
            style={{ background: 'rgba(59,130,246,0.70)' }}
          />
        </RadixSlider.Track>

        <RadixSlider.Thumb
          className={[
            'block w-3 h-3 rounded-full bg-primary',
            'transition-[width,height] duration-[var(--duration-micro)] ease-[var(--ease)]',
            'hover:w-3.5 hover:h-3.5',
            'focus:outline-none',
          ].join(' ')}
          aria-label={label}
        />
      </RadixSlider.Root>
    </div>
  );
}
