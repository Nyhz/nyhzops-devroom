"use client";

import { cn } from '@/lib/utils';

interface Column<T> {
  key: string;
  header: string;
  render: (item: T) => React.ReactNode;
  hideOnMobile?: boolean;
  mobileLabel?: string;
}

interface ResponsiveTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  onRowClick?: (item: T) => void;
  emptyMessage?: string;
  className?: string;
}

export function ResponsiveTable<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  emptyMessage = "No data available",
  className,
}: ResponsiveTableProps<T>) {
  if (data.length === 0) {
    return (
      <div className={cn("py-12 text-center text-sm text-dr-dim font-mono", className)}>
        {emptyMessage}
      </div>
    );
  }

  const mobileColumns = columns.filter((col) => !col.hideOnMobile);

  return (
    <div className={className}>
      {/* Desktop/Tablet: standard table */}
      <table className="hidden md:table w-full text-sm">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className="text-dr-dim uppercase text-xs tracking-wider px-4 py-3 border-b border-dr-border text-left font-mono font-normal"
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((item) => (
            <tr
              key={keyExtractor(item)}
              className={cn(
                "border-b border-dr-border/50",
                onRowClick && "cursor-pointer hover:bg-dr-elevated"
              )}
              onClick={onRowClick ? () => onRowClick(item) : undefined}
            >
              {columns.map((col) => (
                <td key={col.key} className="px-4 py-3 font-mono">
                  {col.render(item)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile: stacked cards */}
      <div className="md:hidden space-y-2">
        {data.map((item) => (
          <div
            key={keyExtractor(item)}
            className={cn(
              "bg-dr-surface border border-dr-border p-4 space-y-2",
              onRowClick && "cursor-pointer active:bg-dr-elevated"
            )}
            onClick={onRowClick ? () => onRowClick(item) : undefined}
          >
            {mobileColumns.map((col) => (
              <div key={col.key} className="flex justify-between items-baseline gap-2">
                <span className="text-dr-dim text-xs font-mono uppercase tracking-wider shrink-0">
                  {col.mobileLabel ?? col.header}
                </span>
                <span className="text-dr-text text-sm font-mono text-right">
                  {col.render(item)}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export type { Column, ResponsiveTableProps };
