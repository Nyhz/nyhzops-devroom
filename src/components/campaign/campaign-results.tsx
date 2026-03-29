import { formatDuration } from '@/lib/utils';
import { Markdown } from '@/components/ui/markdown';

interface ResultMission {
  id: string;
  title: string;
  status: string | null;
  assetCodename: string | null;
  costInput: number | null;
  costOutput: number | null;
  costCacheHit: number | null;
  durationMs: number | null;
  phaseName: string;
  phaseNumber: number;
  phaseDebrief: string | null;
}

interface CampaignResultsProps {
  campaignName: string;
  missions: ResultMission[];
  battlefieldId?: string;
}

export function CampaignResults({ campaignName, missions, battlefieldId }: CampaignResultsProps) {
  const totalDuration = missions.reduce((sum, m) => sum + (m.durationMs || 0), 0);
  const totalInput = missions.reduce((sum, m) => sum + (m.costInput || 0), 0);
  const totalOutput = missions.reduce((sum, m) => sum + (m.costOutput || 0), 0);
  const totalCache = missions.reduce((sum, m) => sum + (m.costCacheHit || 0), 0);
  const totalTokens = totalInput + totalOutput + totalCache;
  const totalCostUsd = (totalInput * 3 + totalOutput * 15 + totalCache * 0.3) / 1_000_000;
  const totalInputContext = totalInput + totalCache;
  const cacheHitPercent = totalInputContext > 0 ? Math.round((totalCache / totalInputContext) * 100) : 0;

  const accomplished = missions.filter(m => m.status === 'accomplished').length;
  const compromised = missions.filter(m => m.status === 'compromised').length;

  // Group by phase
  const phaseMap = new Map<number, { name: string; debrief: string | null; missions: ResultMission[] }>();
  for (const m of missions) {
    if (!phaseMap.has(m.phaseNumber)) {
      phaseMap.set(m.phaseNumber, { name: m.phaseName, debrief: m.phaseDebrief, missions: [] });
    }
    phaseMap.get(m.phaseNumber)!.missions.push(m);
  }
  const phaseList = Array.from(phaseMap.entries()).sort((a, b) => a[0] - b[0]);

  function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="MISSIONS" value={String(missions.length)} />
        <StatCard label="ACCOMPLISHED" value={String(accomplished)} color="text-dr-green" />
        <StatCard label="COMPROMISED" value={String(compromised)} color="text-dr-red" />
        <StatCard label="DURATION" value={formatDuration(totalDuration)} />
        <StatCard label="TOKENS" value={formatTokens(totalTokens)} />
        <StatCard label="COST" value={`$${totalCostUsd.toFixed(2)}`} color="text-dr-amber" />
      </div>

      {/* Cache hit bar */}
      <div className="bg-dr-surface border border-dr-border p-3 flex items-center gap-4 text-xs font-tactical">
        <span className="text-dr-muted">CACHE HIT</span>
        <span className="text-dr-green">{cacheHitPercent}%</span>
        <div className="flex-1 h-1.5 bg-dr-bg overflow-hidden">
          <div className="h-full bg-dr-green" style={{ width: `${cacheHitPercent}%` }} />
        </div>
      </div>

      {/* Phase-by-phase breakdown */}
      {phaseList.map(([phaseNum, phase]) => (
        <div key={phaseNum} className="border border-dr-border border-l-2 border-l-dr-green">
          <div className="bg-dr-elevated px-4 py-2 border-b border-dr-border">
            <span className="text-dr-muted font-tactical text-xs tracking-wider mr-2">
              PHASE {phaseNum}
            </span>
            <span className="text-dr-amber font-tactical text-sm">{phase.name}</span>
          </div>

          {/* Missions summary */}
          <div className="divide-y divide-dr-border/50">
            {phase.missions.map((m) => {
              const row = (
                <div key={m.id} className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`text-xs ${m.status === 'accomplished' ? 'text-dr-green' : m.status === 'compromised' ? 'text-dr-red' : 'text-dr-dim'}`}>●</span>
                      <span className="text-dr-text font-tactical text-sm">{m.title}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs font-tactical text-dr-muted">
                      <span>{m.assetCodename ?? 'UNASSIGNED'}</span>
                      <span>{m.durationMs ? formatDuration(m.durationMs) : '—'}</span>
                      <span>{formatTokens((m.costInput || 0) + (m.costOutput || 0) + (m.costCacheHit || 0))} tok</span>
                    </div>
                  </div>
                </div>
              );
              if (battlefieldId) {
                return (
                  <a key={m.id} href={`/battlefields/${battlefieldId}/missions/${m.id}`} className="block hover:bg-dr-elevated/50 transition-colors">
                    {row}
                  </a>
                );
              }
              return row;
            })}
          </div>

          {/* Phase debrief — toggleable */}
          {phase.debrief && (
            <details className="border-t border-dr-border bg-dr-bg/50">
              <summary className="px-4 py-2.5 cursor-pointer text-dr-muted font-tactical text-xs tracking-wider hover:text-dr-text transition-colors select-none">
                PHASE DEBRIEF
              </summary>
              <div className="px-4 pb-3">
                <Markdown content={phase.debrief} className="text-xs" />
              </div>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-dr-surface border border-dr-border p-3 text-center">
      <div className={`text-lg font-tactical ${color ?? 'text-dr-text'}`}>{value}</div>
      <div className="text-dr-muted font-tactical text-xs tracking-wider mt-1">{label}</div>
    </div>
  );
}
