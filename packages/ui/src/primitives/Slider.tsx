'use client';

import React, { useState } from 'react';
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
  const [dragging, setDragging] = useState(false);
  const displayValue = format ? format(value) : String(value);

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
        onValueChange={([v]) => onChange(v)}
        onPointerDown={() => setDragging(true)}
        onPointerUp={() => setDragging(false)}
        className="relative flex items-center select-none touch-none w-full h-4"
      >
        <RadixSlider.Track className="relative bg-subtle rounded-full h-1 w-full grow overflow-hidden">
          <RadixSlider.Range className="absolute h-full bg-accent rounded-full" />
        </RadixSlider.Track>

        <RadixSlider.Thumb
          className={[
            'block w-3.5 h-3.5 rounded-full bg-primary border border-[var(--border-strong)]',
            'transition-[box-shadow] duration-[var(--duration-fast)]',
            'hover:shadow-[0_0_0_4px_var(--accent-subtle)]',
            'focus:outline-none focus:shadow-[0_0_0_4px_var(--accent-subtle)]',
            dragging ? 'shadow-[0_0_0_4px_var(--accent-subtle)]' : '',
          ].join(' ')}
          aria-label={label}
        />
      </RadixSlider.Root>
    </div>
  );
}
