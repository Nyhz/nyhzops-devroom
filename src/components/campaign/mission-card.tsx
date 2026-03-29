import { cn, formatDuration } from '@/lib/utils';
import { TacBadge } from '@/components/ui/tac-badge';

interface CampaignMissionCardProps {
  title: string;
  assetCodename: string | null;
  status: string | null;
  priority: string | null;
  durationMs: number | null;
  costInput: number | null;
  costOutput: number | null;
  className?: string;
}

const priorityDotColor: Record<string, string> = {
  low: 'bg-dr-dim',
  normal: 'bg-dr-muted',
  high: 'bg-dr-amber',
  critical: 'bg-dr-red',
};

function formatTokens(input: number, output: number): string {
  const total = input + output;
  if (total >= 1000) {
    return `${(total / 1000).toFixed(1)}K tokens`;
  }
  return `${total} tokens`;
}

export function CampaignMissionCard({
  title,
  assetCodename,
  status,
  priority,
  durationMs,
  costInput,
  costOutput,
  className,
}: CampaignMissionCardProps) {
  const normalizedPriority = (priority ?? 'normal').toLowerCase();
  const dotColor = priorityDotColor[normalizedPriority] ?? 'bg-dr-muted';
  const hasMetrics = durationMs != null || (costInput != null && costOutput != null);

  return (
    <div
      className={cn(
        'bg-dr-elevated border border-dr-border p-3 min-w-[200px] max-w-[280px] flex flex-col gap-1.5',
        className,
      )}
    >
      {/* Title row with priority dot */}
      <div className="flex items-start gap-2">
        <span
          className={cn('mt-1.5 h-3 w-3 shrink-0 rounded-full', dotColor)}
          title={`Priority: ${normalizedPriority}`}
        />
        <span className="font-tactical text-sm text-dr-text truncate">
          {title}
        </span>
      </div>

      {/* Asset codename */}
      {assetCodename && (
        <span className="font-tactical text-xs text-dr-muted tracking-wider pl-4">
          {assetCodename}
        </span>
      )}

      {/* Status badge */}
      {status && (
        <div className="pl-4">
          <TacBadge status={status} className="text-xs" />
        </div>
      )}

      {/* Duration + tokens */}
      {hasMetrics && (
        <div className="flex items-center gap-3 pl-4 font-data text-xs text-dr-muted">
          {durationMs != null && (
            <span>{formatDuration(durationMs)}</span>
          )}
          {costInput != null && costOutput != null && (
            <span>{formatTokens(costInput, costOutput)}</span>
          )}
        </div>
      )}
    </div>
  );
}
