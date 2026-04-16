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
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={String(col.key)}
                style={{ width: col.width }}
                className={[
                  'py-2 px-3 text-[11px] font-medium uppercase tracking-[0.04em]',
                  'text-tertiary border-b border-[var(--border)]',
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
              className="border-b border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors duration-[var(--duration-fast)]"
            >
              {columns.map((col) => {
                const value = (row as Record<string, unknown>)[String(col.key)];
                const content = col.render ? col.render(row) : String(value ?? '');
                return (
                  <td
                    key={String(col.key)}
                    className={[
                      'py-2 px-3 h-8',
                      col.numeric
                        ? 'text-right font-mono [font-variant-numeric:tabular-nums] text-primary'
                        : 'text-left text-primary',
                    ].join(' ')}
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
