import Link from 'next/link';
import { getCaptainLogs, getCaptainStats } from '@/actions/captain';
import { Markdown } from '@/components/ui/markdown';
import { formatRelativeTime } from '@/lib/utils';
import { PageWrapper } from '@/components/layout/page-wrapper';

export default async function CaptainLogPage() {
  const [logs, stats] = await Promise.all([
    getCaptainLogs(),
    getCaptainStats(),
  ]);

  const escalationPct = stats.totalDecisions > 0
    ? Math.round(stats.escalationRate * 100)
    : 0;

  return (
    <PageWrapper breadcrumb="HQ" title="CAPTAIN'S LOG">
      <p className="text-sm font-tactical text-dr-muted -mt-4">
        Autonomous decision record — all Captain interventions during mission execution
      </p>

      {/* Stats bar */}
      <div className="flex items-center gap-6 text-sm font-tactical border border-dr-border bg-dr-surface px-4 py-3">
        <div>
          <span className="text-dr-muted">TOTAL DECISIONS</span>{' '}
          <span className="text-dr-green font-bold">{stats.totalDecisions}</span>
        </div>
        <div className="w-px h-4 bg-dr-border" />
        <div>
          <span className="text-dr-muted">ESCALATIONS</span>{' '}
          <span className="text-dr-red font-bold">{stats.escalationCount}</span>
          <span className="text-dr-muted ml-1">({escalationPct}%)</span>
        </div>
        <div className="w-px h-4 bg-dr-border" />
        <div>
          <span className="text-dr-muted">HIGH</span>{' '}
          <span className="text-dr-green">{stats.confidenceDistribution.high}</span>
        </div>
        <div>
          <span className="text-dr-muted">MEDIUM</span>{' '}
          <span className="text-dr-amber">{stats.confidenceDistribution.medium}</span>
        </div>
        <div>
          <span className="text-dr-muted">LOW</span>{' '}
          <span className="text-dr-red">{stats.confidenceDistribution.low}</span>
        </div>
      </div>

      {/* Log entries */}
      {logs.length === 0 ? (
        <div className="border border-dr-border bg-dr-surface px-6 py-12 text-center">
          <p className="text-dr-muted text-sm font-tactical">
            No Captain decisions recorded yet.
          </p>
          <p className="text-dr-muted text-sm font-tactical mt-2">
            The Captain intervenes when an agent stalls during mission execution.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => (
            <div
              key={log.id}
              className={`border bg-dr-surface px-4 py-3 space-y-2 ${
                log.escalated ? 'border-dr-red' : 'border-dr-border'
              }`}
            >
              {/* Top row: timestamp, confidence, escalation */}
              <div className="flex items-center gap-3 text-sm font-tactical">
                <span className="text-dr-muted">
                  {formatRelativeTime(log.timestamp)}
                </span>
                <ConfidenceBadge confidence={log.confidence} />
                {log.escalated ? (
                  <span className="text-dr-red uppercase tracking-wider">
                    ESCALATED
                  </span>
                ) : null}
                <Link
                  href={`/battlefields/${log.battlefieldId}/missions/${log.missionId}`}
                  className="ml-auto text-dr-blue hover:underline"
                >
                  VIEW MISSION
                </Link>
              </div>

              {/* Question */}
              <div className="bg-dr-bg border border-dr-border px-3 py-2">
                <span className="text-xs font-tactical text-dr-muted tracking-wider">
                  AGENT ASKED
                </span>
                <p className="text-sm font-data text-dr-text mt-1 whitespace-pre-wrap">
                  {log.question.length > 500
                    ? log.question.slice(0, 500) + '...'
                    : log.question}
                </p>
              </div>

              {/* Answer */}
              <div>
                <span className="text-xs font-tactical text-dr-muted tracking-wider">
                  CAPTAIN&apos;S ANSWER
                </span>
                <div className="text-dr-green mt-1">
                  <Markdown content={log.answer} className="text-sm" />
                </div>
              </div>

              {/* Reasoning */}
              <div>
                <span className="text-xs font-tactical text-dr-muted tracking-wider">
                  REASONING
                </span>
                <p className="text-sm font-data text-dr-muted italic mt-1">
                  {log.reasoning}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </PageWrapper>
  );
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const colorMap: Record<string, string> = {
    high: 'text-dr-green border-dr-green',
    medium: 'text-dr-amber border-dr-amber',
    low: 'text-dr-red border-dr-red',
  };
  const colors = colorMap[confidence] || colorMap.low;

  return (
    <span
      className={`border px-1.5 py-0.5 text-xs font-tactical uppercase tracking-wider ${colors}`}
    >
      {confidence}
    </span>
  );
}
