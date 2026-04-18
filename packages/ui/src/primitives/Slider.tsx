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

  // Equality guard: don't call onChange if Radix emits the same value (floating-
  // point snap on initial mount). Without this guard the controlled value → snap
  // → setState → re-render cycle repeats until React throws "Maximum update depth
  // exceeded" via @radix-ui/react-compose-refs.
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
    <div className="space-y-2">
      {/* Label row */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-tertiary">{label}</span>
        <span className="mono text-[12px] text-primary">{displayValue}</span>
      </div>

      {/* Track */}
      <RadixSlider.Root
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={handleValueChange}
        className="relative flex items-center select-none touch-none w-full h-4"
      >
        <RadixSlider.Track className="relative bg-[var(--border-strong)] rounded-full h-0.5 w-full grow overflow-hidden">
          <RadixSlider.Range className="absolute h-full bg-accent/60 rounded-full" />
        </RadixSlider.Track>

        <RadixSlider.Thumb
          className={[
            'block w-3 h-3 rounded-full bg-primary',
            'transition-[width,height,box-shadow] duration-[var(--duration-fast)]',
            'hover:w-3.5 hover:h-3.5 hover:shadow-[0_0_0_3px_var(--accent-subtle)]',
            'focus:outline-none focus:shadow-[0_0_0_3px_var(--accent-subtle)]',
            'active:shadow-[0_0_0_3px_var(--accent-subtle)]',
          ].join(' ')}
          aria-label={label}
        />
      </RadixSlider.Root>
    </div>
  );
}
