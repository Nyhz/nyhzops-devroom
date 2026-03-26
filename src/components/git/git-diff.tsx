import { cn } from '@/lib/utils';

interface GitDiffProps {
  diff: string;
  filePath: string;
  className?: string;
}

export function GitDiff({ diff, filePath, className }: GitDiffProps) {
  const lines = diff.split('\n');

  return (
    <div className={cn('bg-dr-bg border border-dr-border overflow-auto', className)}>
      <div className="px-3 py-2 border-b border-dr-border bg-dr-surface">
        <span className="font-tactical text-xs text-dr-amber tracking-wider">
          {filePath}
        </span>
      </div>
      <pre className="font-data text-xs leading-5 p-0 m-0">
        {lines.map((line, i) => {
          let lineClass = 'text-dr-dim';

          if (line.startsWith('+')) {
            lineClass = 'text-dr-green bg-dr-green/5';
          } else if (line.startsWith('-')) {
            lineClass = 'text-dr-red bg-dr-red/5';
          } else if (line.startsWith('@@')) {
            lineClass = 'text-dr-amber bg-dr-amber/5';
          }

          return (
            <div key={i} className={cn('px-3 min-h-[20px]', lineClass)}>
              {line || ' '}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
