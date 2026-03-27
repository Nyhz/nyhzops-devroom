import {
  getGlobalStats,
  getCostByBattlefield,
  getCostByAsset,
  getDailyUsage,
  getRateLimitStatus,
} from '@/actions/logistics';
import { PageWrapper } from '@/components/layout/page-wrapper';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

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
    <PageWrapper>
      {/* Header */}
      <div>
        <h1 className="text-dr-amber font-tactical text-xl tracking-widest uppercase">
          LOGISTICS
        </h1>
        <div className="text-dr-muted font-tactical text-xs mt-1">
          Resource allocation and expenditure tracking
        </div>
      </div>

      {/* Totals Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-dr-surface border border-dr-border p-5">
          <div className="text-dr-dim text-[10px] tracking-widest uppercase">Total Missions</div>
          <div className="text-dr-text text-lg font-tactical mt-1">{stats.totalMissions}</div>
        </div>
        <div className="bg-dr-surface border border-dr-border p-5">
          <div className="text-dr-dim text-[10px] tracking-widest uppercase">Total Tokens</div>
          <div className="text-dr-text text-lg font-tactical mt-1">
            {formatTokens(stats.totalInputTokens + stats.totalOutputTokens + stats.totalCacheTokens)}
          </div>
        </div>
        <div className="bg-dr-surface border border-dr-border p-5">
          <div className="text-dr-dim text-[10px] tracking-widest uppercase">Total Cost</div>
          <div className="text-dr-amber text-lg font-tactical mt-1">
            {formatCost(stats.totalCostUsd)}
          </div>
        </div>
        <div className="bg-dr-surface border border-dr-border p-5">
          <div className="text-dr-dim text-[10px] tracking-widest uppercase">Cache Hit Rate</div>
          <div className="text-dr-green text-lg font-tactical mt-1">
            {stats.cacheHitPercent}%
          </div>
        </div>
      </div>

      {/* Plan Status Card */}
      <div className="bg-dr-surface border border-dr-border p-4">
        <div className="text-dr-amber text-xs tracking-widest uppercase font-bold mb-3">
          RATE LIMIT STATUS
        </div>
        {rateLimit ? (
          <div className="space-y-2">
            <div className="flex items-center gap-4 text-xs">
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
      </div>

      {/* Cost Breakdown — two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Per Battlefield */}
        <div className="bg-dr-surface border border-dr-border p-4">
          <div className="text-dr-amber text-xs tracking-widest uppercase font-bold mb-3">
            COST BY BATTLEFIELD
          </div>
          {byBattlefield.length === 0 ? (
            <div className="text-dr-dim text-xs">No battlefield data yet</div>
          ) : (
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
          )}
        </div>

        {/* Per Asset */}
        <div className="bg-dr-surface border border-dr-border p-4">
          <div className="text-dr-amber text-xs tracking-widest uppercase font-bold mb-3">
            COST BY ASSET
          </div>
          {byAsset.length === 0 ? (
            <div className="text-dr-dim text-xs">No asset data yet</div>
          ) : (
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
          )}
        </div>
      </div>

      {/* Usage Over Time */}
      <div className="bg-dr-surface border border-dr-border p-4">
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
      </div>

      {/* Mission Status Breakdown */}
      <div className="bg-dr-surface border border-dr-border p-4">
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
      </div>
    </PageWrapper>
  );
}
