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
    <RadixTabs.List className="flex items-end border-b border-[var(--border-subtle)]">
      {tabs.map((tab) => (
        <RadixTabs.Trigger
          key={tab.value}
          value={tab.value}
          className={[
            'relative px-3 pb-2 pt-1',
            'text-[13px] font-medium text-secondary',
            'transition-colors duration-[var(--duration-micro)] ease-[var(--ease)]',
            'hover:text-primary',
            'outline-none select-none whitespace-nowrap',
            'data-[state=active]:text-primary',
            // 2px underline for active state
            'after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:content-[""]',
            'after:transition-[background-color] after:duration-[var(--duration-micro)]',
            'after:bg-transparent data-[state=active]:after:bg-accent',
          ].join(' ')}
        >
          {tab.label}
        </RadixTabs.Trigger>
      ))}
    </RadixTabs.List>
  );
}

export { RadixTabs as TabsPrimitive };
