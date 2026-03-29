import {
  getGlobalStats,
  getCostByBattlefield,
  getCostByAsset,
  getDailyUsage,
  getRateLimitStatus,
} from '@/actions/logistics';
import { PageWrapper } from '@/components/layout/page-wrapper';
import { TacCard } from '@/components/ui/tac-card';
import { formatTokens, formatCost } from '@/lib/utils';

function formatTime(ms: number): string {
  const now = Date.now();
  const diff = ms - now;
  if (diff <= 0) return 'now';
  const mins = Math.ceil(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

export default async function LogisticsPage() {
  const [stats, byBattlefield, byAsset, dailyUsage, rateLimit] = await Promise.all([
    getGlobalStats(),
    getCostByBattlefield(),
    getCostByAsset(),
    getDailyUsage(30),
    getRateLimitStatus(),
  ]);

  const maxDailyTokens = Math.max(
    ...dailyUsage.map((d) => d.inputTokens + d.outputTokens + d.cacheTokens),
    1,
  );

  return (
    <PageWrapper breadcrumb="HQ" title="LOGISTICS">
      <p className="text-xs font-tactical text-dr-muted -mt-4">
        Resource allocation and expenditure tracking
      </p>

      {/* Totals Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <TacCard className="p-3 sm:p-5">
          <div className="text-dr-dim text-[10px] tracking-widest uppercase">Total Missions</div>
          <div className="text-dr-text text-lg font-tactical mt-1">{stats.totalMissions}</div>
        </TacCard>
        <TacCard className="p-3 sm:p-5">
          <div className="text-dr-dim text-[10px] tracking-widest uppercase">Total Tokens</div>
          <div className="text-dr-text text-lg font-tactical mt-1">
            {formatTokens(stats.totalInputTokens + stats.totalOutputTokens + stats.totalCacheTokens)}
          </div>
        </TacCard>
        <TacCard className="p-3 sm:p-5">
          <div className="text-dr-dim text-[10px] tracking-widest uppercase">Total Cost</div>
          <div className="text-dr-amber text-lg font-tactical mt-1">
            {formatCost(stats.totalCostUsd)}
          </div>
        </TacCard>
        <TacCard className="p-3 sm:p-5">
          <div className="text-dr-dim text-[10px] tracking-widest uppercase">Cache Hit Rate</div>
          <div className="text-dr-green text-lg font-tactical mt-1">
            {stats.cacheHitPercent}%
          </div>
        </TacCard>
      </div>

      {/* Plan Status Card */}
      <TacCard className="p-4">
        <div className="text-dr-amber text-xs tracking-widest uppercase font-bold mb-3">
          RATE LIMIT STATUS
        </div>
        {rateLimit ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs">
              <div className="flex items-center gap-2">
                <span
                  className={
                    rateLimit.status === 'allowed'
                      ? 'text-dr-green text-[8px]'
                      : 'text-dr-red text-[8px]'
                  }
                >
                  {'\u25CF'}
                </span>
                <span className="text-dr-text uppercase">{rateLimit.status}</span>
              </div>
              <div className="text-dr-muted">
                Type: <span className="text-dr-text">{rateLimit.rateLimitType}</span>
              </div>
              {rateLimit.resetsAt > 0 && (
                <div className="text-dr-muted">
                  Resets: <span className="text-dr-text">{formatTime(rateLimit.resetsAt)}</span>
                </div>
              )}
              <div className="text-dr-dim">
                Updated: {new Date(rateLimit.lastUpdated).toLocaleTimeString()}
              </div>
            </div>
            {/* Progress bar indicator */}
            <div className="h-1 bg-dr-border rounded-none overflow-hidden">
              <div
                className={`h-full ${rateLimit.status === 'allowed' ? 'bg-dr-green' : 'bg-dr-red'}`}
                style={{ width: rateLimit.status === 'allowed' ? '100%' : '15%' }}
              />
            </div>
          </div>
        ) : (
          <div className="text-dr-dim text-xs">
            No rate limit data yet — deploy a mission to begin tracking
          </div>
        )}
      </TacCard>

      {/* Cost Breakdown — two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Per Battlefield */}
        <TacCard className="p-4">
          <div className="text-dr-amber text-xs tracking-widest uppercase font-bold mb-3">
            COST BY BATTLEFIELD
          </div>
          {byBattlefield.length === 0 ? (
            <div className="text-dr-dim text-xs">No battlefield data yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-dr-dim border-b border-dr-border">
                    <th className="text-left py-1.5 font-normal">CODENAME</th>
                    <th className="text-right py-1.5 font-normal">MISSIONS</th>
                    <th className="text-right py-1.5 font-normal">TOKENS</th>
                    <th className="text-right py-1.5 font-normal">COST</th>
                  </tr>
                </thead>
                <tbody>
                  {byBattlefield.map((b) => (
                    <tr key={b.battlefieldId} className="border-b border-dr-border/50">
                      <td className="py-1.5 text-dr-text">{b.codename}</td>
                      <td className="py-1.5 text-dr-muted text-right">{b.missionCount}</td>
                      <td className="py-1.5 text-dr-muted text-right">
                        {formatTokens(b.totalInputTokens + b.totalOutputTokens + b.totalCacheTokens)}
                      </td>
                      <td className="py-1.5 text-dr-amber text-right">{formatCost(b.totalCostUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TacCard>

        {/* Per Asset */}
        <TacCard className="p-4">
          <div className="text-dr-amber text-xs tracking-widest uppercase font-bold mb-3">
            COST BY ASSET
          </div>
          {byAsset.length === 0 ? (
            <div className="text-dr-dim text-xs">No asset data yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-dr-dim border-b border-dr-border">
                    <th className="text-left py-1.5 font-normal">CODENAME</th>
                    <th className="text-right py-1.5 font-normal">MISSIONS</th>
                    <th className="text-right py-1.5 font-normal">TOKENS</th>
                    <th className="text-right py-1.5 font-normal">COST</th>
                  </tr>
                </thead>
                <tbody>
                  {byAsset.map((a) => (
                    <tr key={a.assetId} className="border-b border-dr-border/50">
                      <td className="py-1.5 text-dr-text">{a.codename}</td>
                      <td className="py-1.5 text-dr-muted text-right">{a.missionCount}</td>
                      <td className="py-1.5 text-dr-muted text-right">
                        {formatTokens(a.totalInputTokens + a.totalOutputTokens + a.totalCacheTokens)}
                      </td>
                      <td className="py-1.5 text-dr-amber text-right">{formatCost(a.totalCostUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TacCard>
      </div>

      {/* Usage Over Time */}
      <TacCard className="p-4">
        <div className="text-dr-amber text-xs tracking-widest uppercase font-bold mb-3">
          USAGE — LAST 30 DAYS
        </div>
        {dailyUsage.length === 0 ? (
          <div className="text-dr-dim text-xs">No usage data yet</div>
        ) : (
          <div className="space-y-2">
            {/* Bar chart */}
            <div className="flex items-end gap-[2px] h-32">
              {dailyUsage.map((d) => {
                const total = d.inputTokens + d.outputTokens + d.cacheTokens;
                const heightPercent = (total / maxDailyTokens) * 100;
                const inputPct = total > 0 ? (d.inputTokens / total) * 100 : 0;
                const outputPct = total > 0 ? (d.outputTokens / total) * 100 : 0;
                const cachePct = total > 0 ? (d.cacheTokens / total) * 100 : 0;

                return (
                  <div
                    key={d.date}
                    className="flex-1 flex flex-col justify-end min-w-[4px]"
                    title={`${d.date}: ${formatTokens(total)} tokens`}
                    style={{ height: '100%' }}
                  >
                    <div
                      className="flex flex-col"
                      style={{ height: `${heightPercent}%` }}
                    >
                      {/* Input (blue) */}
                      <div
                        className="bg-dr-blue"
                        style={{ height: `${inputPct}%`, minHeight: inputPct > 0 ? '1px' : '0' }}
                      />
                      {/* Output (amber) */}
                      <div
                        className="bg-dr-amber"
                        style={{ height: `${outputPct}%`, minHeight: outputPct > 0 ? '1px' : '0' }}
                      />
                      {/* Cache (green) */}
                      <div
                        className="bg-dr-green"
                        style={{ height: `${cachePct}%`, minHeight: cachePct > 0 ? '1px' : '0' }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Legend */}
            <div className="flex items-center gap-4 text-[10px] text-dr-muted">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-dr-blue inline-block" /> Input
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-dr-amber inline-block" /> Output
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-dr-green inline-block" /> Cache
              </span>
            </div>
          </div>
        )}
      </TacCard>

      {/* Mission Status Breakdown */}
      <TacCard className="p-4">
        <div className="text-dr-amber text-xs tracking-widest uppercase font-bold mb-3">
          MISSION STATUS BREAKDOWN
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <span className="text-dr-amber">{'\u25CF'}</span>{' '}
            <span className="text-dr-muted">IN COMBAT</span>{' '}
            <span className="text-dr-text">{stats.inCombat + stats.deploying}</span>
          </div>
          <div>
            <span className="text-dr-green">{'\u25CF'}</span>{' '}
            <span className="text-dr-muted">ACCOMPLISHED</span>{' '}
            <span className="text-dr-text">{stats.accomplished}</span>
          </div>
          <div>
            <span className="text-dr-red">{'\u25CF'}</span>{' '}
            <span className="text-dr-muted">COMPROMISED</span>{' '}
            <span className="text-dr-text">{stats.compromised}</span>
          </div>
          <div>
            <span className="text-dr-dim">{'\u25CF'}</span>{' '}
            <span className="text-dr-muted">STANDBY/QUEUED</span>{' '}
            <span className="text-dr-text">{stats.standby + stats.queued}</span>
          </div>
        </div>
      </TacCard>
    </PageWrapper>
  );
}
