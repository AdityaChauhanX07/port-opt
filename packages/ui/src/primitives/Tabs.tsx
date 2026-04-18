'use client';

import React, { useCallback } from 'react';
import * as RadixTabs from '@radix-ui/react-tabs';

interface Tab {
  value: string;
  label: string;
}

interface TabsProps {
  tabs: Tab[];
  value: string;
  onValueChange: (value: string) => void;
  children?: React.ReactNode;
  className?: string;
}

export function Tabs({ tabs, value, onValueChange, children, className = '' }: TabsProps) {
  const handleValueChange = useCallback(
    (v: string) => {
      if (v !== value) onValueChange(v);
    },
    [value, onValueChange],
  );

  return (
    <RadixTabs.Root value={value} onValueChange={handleValueChange} className={className}>
      <TabsList tabs={tabs} />
      {children}
    </RadixTabs.Root>
  );
}

function TabsList({ tabs }: { tabs: Tab[] }) {
  return (
    <RadixTabs.List className="flex items-end border-b border-[var(--border)] gap-1">
      {tabs.map((tab) => (
        <RadixTabs.Trigger
          key={tab.value}
          value={tab.value}
          className={[
            'relative px-3 pb-2 pt-1',
            'text-[12px] font-medium text-secondary',
            'transition-[color,border-color] duration-[var(--duration)]',
            'hover:text-primary',
            'outline-none select-none whitespace-nowrap',
            // Active underline via pseudo-element using box-shadow
            'data-[state=active]:text-primary',
            'data-[state=active]:after:absolute data-[state=active]:after:bottom-0',
            'data-[state=active]:after:left-0 data-[state=active]:after:right-0',
            'data-[state=active]:after:h-px data-[state=active]:after:bg-accent',
            'after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:content-[""]',
            'after:transition-colors after:duration-[var(--duration)]',
          ].join(' ')}
        >
          {tab.label}
        </RadixTabs.Trigger>
      ))}
    </RadixTabs.List>
  );
}

export { RadixTabs as TabsPrimitive };
