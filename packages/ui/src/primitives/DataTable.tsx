import React from 'react';

export interface Column<T> {
  key: keyof T | string;
  header: string;
  numeric?: boolean;
  render?: (row: T) => React.ReactNode;
  width?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, idx: number) => string | number;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  className = '',
}: DataTableProps<T>) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={String(col.key)}
                style={{ width: col.width }}
                className={[
                  'py-2 px-3 h-8',
                  'text-[11px] font-medium uppercase tracking-[0.08em]',
                  'text-tertiary',
                  col.numeric ? 'text-right' : 'text-left',
                ].join(' ')}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={rowKey(row, idx)}
              style={{
                background: idx % 2 === 1 ? 'color-mix(in srgb, var(--bg-inset) 50%, transparent)' : 'transparent',
              }}
              className="hover:bg-[var(--surface-elevated)] transition-colors duration-[var(--duration-micro)]"
            >
              {columns.map((col) => {
                const value = (row as Record<string, unknown>)[String(col.key)];
                const content = col.render ? col.render(row) : String(value ?? '');
                return (
                  <td
                    key={String(col.key)}
                    className={[
                      'px-3 h-8 text-[13px]',
                      col.numeric
                        ? 'text-right text-primary [font-variant-numeric:tabular-nums]'
                        : 'text-left text-primary',
                    ].join(' ')}
                    style={col.numeric ? { fontFamily: 'var(--font-mono)' } : undefined}
                  >
                    {content}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
