import { TacCard } from '@/components/ui/tac-card';
import { cn } from '@/lib/utils';
import type { Debrief, DebriefConfidence } from '@/control/debrief/schema';

interface DebriefPanelProps {
  debrief: Debrief | null;
  debriefText: string | null;
  isSynthesized: boolean;
  isCompromised: boolean;
}

function ConfidenceBadge({ confidence }: { confidence: DebriefConfidence }) {
  const colorClass =
    confidence === 'high'
      ? 'text-dr-green border-dr-green'
      : confidence === 'medium'
        ? 'text-dr-amber border-dr-amber'
        : 'text-dr-red border-dr-red';

  return (
    <span
      className={cn(
        'border px-1.5 py-0.5 text-[10px] font-tactical uppercase tracking-wider',
        colorClass,
      )}
    >
      {confidence}
    </span>
  );
}

export function DebriefPanel({
  debrief,
  debriefText,
  isSynthesized,
  isCompromised,
}: DebriefPanelProps) {
  const hasContent = debrief || debriefText;
  if (!hasContent) return null;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-tactical text-dr-amber tracking-wider">
            {isCompromised ? 'SITUATION REPORT' : 'DEBRIEF'}
          </h2>
          {isSynthesized && (
            <span className="border border-dr-green/50 bg-dr-green/10 px-1.5 py-0.5 text-[10px] font-tactical text-dr-green uppercase tracking-wider">
              SYNTHESIZED
            </span>
          )}
          {debrief && <ConfidenceBadge confidence={debrief.confidence} />}
        </div>
        <div className="h-px bg-dr-border" />
      </div>

      <div className="space-y-4">
        {/* Structured debrief fields */}
        {debrief ? (
          <>
            {/* Summary */}
            <TacCard
              className={cn(
                'p-2.5 sm:p-4',
                isCompromised ? 'bg-dr-red/5 border-dr-red/30' : '',
              )}
            >
              <p className="font-data text-sm text-dr-text whitespace-pre-wrap leading-relaxed">
                {debrief.summary}
              </p>
            </TacCard>

            {/* Commits */}
            {debrief.commits.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-tactical text-dr-muted uppercase tracking-wider">
                  COMMITS ({debrief.commits.length})
                </h3>
                <div className="space-y-1">
                  {debrief.commits.map((commit, i) => (
                    <div
                      key={i}
                      className="font-mono text-xs text-dr-green bg-dr-surface border border-dr-border px-2 py-1"
                    >
                      {commit}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Files touched */}
            {debrief.files_touched.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-tactical text-dr-muted uppercase tracking-wider">
                  FILES TOUCHED ({debrief.files_touched.length})
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {debrief.files_touched.map((file, i) => (
                    <span
                      key={i}
                      className="font-mono text-[11px] text-dr-text bg-dr-surface border border-dr-border px-1.5 py-0.5"
                    >
                      {file}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Open questions */}
            {debrief.open_questions.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-tactical text-dr-muted uppercase tracking-wider">
                  OPEN QUESTIONS ({debrief.open_questions.length})
                </h3>
                <div className="space-y-2">
                  {debrief.open_questions.map((q, i) => {
                    const severityColor =
                      q.severity === 'high'
                        ? 'border-dr-red/40 bg-dr-red/5'
                        : q.severity === 'medium'
                          ? 'border-dr-amber/40 bg-dr-amber/5'
                          : 'border-dr-border bg-dr-surface';
                    const severityTextColor =
                      q.severity === 'high'
                        ? 'text-dr-red'
                        : q.severity === 'medium'
                          ? 'text-dr-amber'
                          : 'text-dr-muted';

                    return (
                      <TacCard key={i} className={cn('px-3 py-2.5 space-y-1', severityColor)}>
                        <div className="flex items-center gap-2">
                          <span className={cn('text-[10px] font-tactical uppercase tracking-wider', severityTextColor)}>
                            {q.severity}
                          </span>
                          <span className="text-xs font-tactical text-dr-text">{q.title}</span>
                        </div>
                        <p className="font-data text-xs text-dr-muted">{q.description}</p>
                      </TacCard>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          /* Fallback: plain prose debrief text */
          <TacCard
            className={cn(
              'p-2.5 sm:p-4',
              isCompromised ? 'bg-dr-red/5 border-dr-red/30' : '',
            )}
          >
            <p className="font-data text-sm text-dr-text whitespace-pre-wrap leading-relaxed">
              {debriefText}
            </p>
          </TacCard>
        )}
      </div>
    </div>
  );
}
