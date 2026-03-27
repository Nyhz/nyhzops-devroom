'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useActivityFeed, type ActivityEvent } from '@/hooks/use-activity-feed';
import { useSocket } from '@/hooks/use-socket';
import { TacBadge } from '@/components/ui/tac-badge';
import { BootSequence } from './boot-sequence';
import { formatRelativeTime, formatDuration } from '@/lib/utils';
import type { Mission, Campaign, Phase, Asset, Battlefield } from '@/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface WarRoomProps {
  stats: {
    inCombat: number;
    accomplished: number;
    compromised: number;
    standby: number;
    queued: number;
    totalBattlefields: number;
    cacheHitPercent: number;
  };
  activeMissions: Array<
    Mission & {
      assetCodename: string | null;
      battlefieldCodename: string;
      lastCommsLine: string | null;
    }
  >;
  activeCampaigns: Array<
    Campaign & {
      battlefieldCodename: string;
      phases: Array<Phase & { missionCount: number }>;
    }
  >;
  assetDeployment: Array<
    Asset & {
      currentStatus: 'idle' | 'in_combat' | 'queued';
      currentMissionTitle: string | null;
    }
  >;
  battlefieldSummaries: Array<{
    id: string;
    codename: string;
    missionCount: number;
    activeCount: number;
  }>;
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------
function useClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);
  return time;
}

// ---------------------------------------------------------------------------
// Activity icon
// ---------------------------------------------------------------------------
function activityIcon(type: string): string {
  switch (type) {
    case 'mission:status':
      return '\u25A0'; // filled square
    case 'mission:deployed':
      return '\u25B6'; // play
    case 'mission:completed':
      return '\u2713'; // check
    case 'mission:failed':
      return '\u2717'; // x
    default:
      return '\u25CF'; // dot
  }
}

function activityColor(type: string): string {
  if (type.includes('failed') || type.includes('compromised')) return 'text-dr-red';
  if (type.includes('completed') || type.includes('accomplished')) return 'text-dr-green';
  if (type.includes('deployed') || type.includes('combat')) return 'text-dr-amber';
  return 'text-dr-muted';
}

// ---------------------------------------------------------------------------
// War Room Component
// ---------------------------------------------------------------------------
export function WarRoom(props: WarRoomProps) {
  const [booted, setBooted] = useState(false);
  const handleBootComplete = useCallback(() => setBooted(true), []);

  if (!booted) {
    return (
      <BootSequence
        battlefieldCount={props.stats.totalBattlefields}
        inCombatCount={props.stats.inCombat}
        onComplete={handleBootComplete}
      />
    );
  }

  return <WarRoomDashboard {...props} />;
}

// ---------------------------------------------------------------------------
// Dashboard (post-boot)
// ---------------------------------------------------------------------------
function WarRoomDashboard({
  stats,
  activeMissions,
  activeCampaigns,
  assetDeployment,
  battlefieldSummaries,
}: WarRoomProps) {
  const clock = useClock();
  const events = useActivityFeed();
  const socket = useSocket();

  // Live mission status updates
  const [liveMissions, setLiveMissions] = useState(activeMissions);

  useEffect(() => {
    if (!socket) return;

    const handleStatus = (data: { missionId: string; status: string }) => {
      setLiveMissions((prev) =>
        prev.map((m) =>
          m.id === data.missionId ? { ...m, status: data.status } : m
        ).filter((m) => !['accomplished', 'compromised', 'abandoned'].includes(m.status ?? ''))
      );
    };

    socket.on('mission:status', handleStatus);
    return () => { socket.off('mission:status', handleStatus); };
  }, [socket]);

  const maxAgents = 5; // from config default
  const agentsInUse = stats.inCombat;
  const timeStr = clock.toLocaleTimeString('en-US', { hour12: false });
  const dateStr = clock.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="h-screen flex flex-col bg-dr-bg">
      {/* ── Top Bar ─────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-dr-border bg-dr-surface shrink-0">
        <div className="flex items-center gap-3">
          {/* Brand */}
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-dr-green/20 border border-dr-green/40 flex items-center justify-center">
              <span className="text-dr-green font-tactical text-sm font-bold">N</span>
            </div>
            <div>
              <span className="text-dr-text font-tactical text-sm tracking-wider">DEVROOM</span>
              <span className="text-dr-amber font-tactical text-[10px] tracking-widest ml-2">WAR ROOM</span>
            </div>
          </div>
        </div>

        {/* Status indicators */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-1.5">
            <span className="text-dr-dim font-tactical text-[10px] tracking-wider">AGENTS:</span>
            <span className={`font-tactical text-xs ${agentsInUse > 0 ? 'text-dr-amber' : 'text-dr-green'}`}>
              {agentsInUse}/{maxAgents}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-dr-dim font-tactical text-[10px] tracking-wider">QUEUE:</span>
            <span className="font-tactical text-xs text-dr-text">{stats.queued}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-dr-dim font-tactical text-[10px] tracking-wider">OPS:</span>
            <span className="font-tactical text-xs text-dr-green">{stats.accomplished}</span>
            <span className="text-dr-dim font-tactical text-[10px]">/</span>
            <span className="font-tactical text-xs text-dr-red">{stats.compromised}</span>
          </div>
          <div className="text-dr-muted font-data text-xs">
            {dateStr} {timeStr}
          </div>
          <Link
            href="/battlefields"
            className="px-3 py-1 bg-dr-green/10 border border-dr-green/40 text-dr-green font-tactical text-xs tracking-wider hover:bg-dr-green/20 transition-colors"
          >
            ENTER HQ
          </Link>
        </div>
      </header>

      {/* ── Main Content ────────────────────────────────────────── */}
      <div className="flex-1 grid grid-cols-[280px_1fr_280px] min-h-0">
        {/* Left: Activity Feed */}
        <aside className="border-r border-dr-border bg-dr-surface overflow-y-auto">
          <div className="px-3 py-3 border-b border-dr-border">
            <span className="text-dr-amber font-tactical text-xs tracking-widest uppercase">
              LIVE ACTIVITY FEED
            </span>
          </div>
          <div className="p-2 space-y-0.5">
            {events.length === 0 && (
              <div className="text-dr-dim font-data text-[11px] px-2 py-4 text-center">
                Awaiting signals...
              </div>
            )}
            {events.map((evt, i) => (
              <ActivityItem key={`${evt.timestamp}-${i}`} event={evt} />
            ))}
          </div>
        </aside>

        {/* Center: Active Operations */}
        <main className="overflow-y-auto">
          <div className="px-4 py-3 border-b border-dr-border flex items-center justify-between">
            <span className="text-dr-amber font-tactical text-xs tracking-widest uppercase">
              ACTIVE OPERATIONS
            </span>
            <div className="flex items-center gap-4">
              <StatChip label="IN COMBAT" value={stats.inCombat} color="text-dr-amber" />
              <StatChip label="QUEUED" value={stats.queued} color="text-dr-blue" />
              <StatChip label="STANDBY" value={stats.standby} color="text-dr-dim" />
            </div>
          </div>
          <div className="p-4 space-y-2">
            {liveMissions.length === 0 && (
              <div className="text-dr-dim font-data text-xs text-center py-12">
                No active operations. All quiet on the front.
              </div>
            )}
            {liveMissions.map((mission) => (
              <MissionCard key={mission.id} mission={mission} />
            ))}
          </div>
        </main>

        {/* Right: Campaign Progress + Asset Deployment */}
        <aside className="border-l border-dr-border bg-dr-surface overflow-y-auto">
          {/* Campaign Progress */}
          <div className="px-3 py-3 border-b border-dr-border">
            <span className="text-dr-amber font-tactical text-xs tracking-widest uppercase">
              CAMPAIGN PROGRESS
            </span>
          </div>
          <div className="p-3 space-y-3">
            {activeCampaigns.length === 0 && (
              <div className="text-dr-dim font-data text-[11px] text-center py-4">
                No active campaigns
              </div>
            )}
            {activeCampaigns.map((campaign) => (
              <CampaignCard key={campaign.id} campaign={campaign} />
            ))}
          </div>

          {/* Asset Deployment */}
          <div className="px-3 py-3 border-b border-t border-dr-border">
            <span className="text-dr-amber font-tactical text-xs tracking-widest uppercase">
              ASSET DEPLOYMENT
            </span>
          </div>
          <div className="p-3 space-y-1.5">
            {assetDeployment.map((asset) => (
              <div key={asset.id} className="flex items-center gap-2">
                <span
                  className={`text-[8px] ${
                    asset.currentStatus === 'in_combat'
                      ? 'text-dr-amber'
                      : asset.currentStatus === 'queued'
                        ? 'text-dr-blue'
                        : 'text-dr-green'
                  }`}
                >
                  &#9679;
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-dr-text font-tactical text-xs">{asset.codename}</div>
                  <div className="text-dr-dim font-data text-[10px] truncate">
                    {asset.currentStatus === 'idle'
                      ? 'Standing by'
                      : asset.currentMissionTitle ?? asset.currentStatus.toUpperCase()}
                  </div>
                </div>
                <span
                  className={`font-tactical text-[10px] tracking-wider ${
                    asset.currentStatus === 'in_combat'
                      ? 'text-dr-amber'
                      : asset.currentStatus === 'queued'
                        ? 'text-dr-blue'
                        : 'text-dr-dim'
                  }`}
                >
                  {asset.currentStatus === 'idle'
                    ? 'IDLE'
                    : asset.currentStatus === 'in_combat'
                      ? 'ACTIVE'
                      : 'QUEUED'}
                </span>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {/* ── Bottom Bar: Battlefield Chips ───────────────────────── */}
      <footer className="flex items-center gap-0 border-t border-dr-border bg-dr-surface shrink-0 overflow-x-auto">
        {battlefieldSummaries.map((bf) => (
          <Link
            key={bf.id}
            href={`/battlefields/${bf.id}`}
            className="flex items-center gap-2 px-4 py-1.5 border-r border-dr-border hover:bg-dr-elevated transition-colors shrink-0"
          >
            <span className="text-dr-text font-tactical text-[11px] tracking-wider">
              {bf.codename}
            </span>
            <span className="text-dr-dim font-data text-[10px]">
              {bf.missionCount}
            </span>
            {bf.activeCount > 0 && (
              <span className="text-dr-amber font-tactical text-[10px]">
                &#9679; {bf.activeCount}
              </span>
            )}
          </Link>
        ))}
        {battlefieldSummaries.length === 0 && (
          <div className="px-4 py-1.5 text-dr-dim font-tactical text-[11px]">
            No battlefields deployed
          </div>
        )}
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`font-tactical text-xs ${color}`}>{value}</span>
      <span className="text-dr-dim font-tactical text-[10px] tracking-wider">{label}</span>
    </div>
  );
}

function ActivityItem({ event }: { event: ActivityEvent }) {
  return (
    <div className="px-2 py-1.5 hover:bg-dr-elevated/50 transition-colors">
      <div className="flex items-center gap-1.5">
        <span className={`text-[10px] ${activityColor(event.type)}`}>
          {activityIcon(event.type)}
        </span>
        <span className="text-dr-muted font-data text-[10px] truncate flex-1">
          {event.battlefieldCodename}
        </span>
        <span className="text-dr-dim font-data text-[10px] shrink-0">
          {formatRelativeTime(event.timestamp)}
        </span>
      </div>
      <div className="text-dr-text font-data text-[11px] truncate mt-0.5 pl-4">
        {event.missionTitle}
      </div>
      {event.detail && (
        <div className="text-dr-dim font-data text-[10px] truncate mt-0.5 pl-4">
          {event.detail}
        </div>
      )}
    </div>
  );
}

function MissionCard({
  mission,
}: {
  mission: WarRoomProps['activeMissions'][number];
}) {
  const isInCombat = mission.status === 'in_combat';
  const duration = mission.startedAt ? Date.now() - mission.startedAt : 0;

  return (
    <div
      className={`border bg-dr-surface p-3 ${
        isInCombat ? 'border-dr-amber/40' : 'border-dr-border'
      }`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-dr-text font-tactical text-xs truncate flex-1 mr-2">
          {mission.title}
        </span>
        <TacBadge status={mission.status ?? 'standby'} />
      </div>
      <div className="flex items-center gap-3 text-dr-dim font-data text-[10px]">
        {mission.assetCodename && (
          <span className="text-dr-muted">{mission.assetCodename}</span>
        )}
        <span>{mission.battlefieldCodename}</span>
        {mission.startedAt && <span>{formatDuration(duration)}</span>}
        {(mission.costInput ?? 0) + (mission.costOutput ?? 0) > 0 && (
          <span>
            {(((mission.costInput ?? 0) + (mission.costOutput ?? 0)) / 1000).toFixed(1)}K tok
          </span>
        )}
      </div>
      {isInCombat && mission.lastCommsLine && (
        <div className="mt-2 bg-dr-bg border border-dr-border px-2 py-1 overflow-hidden">
          <div className="text-dr-muted font-data text-[10px] truncate">
            {mission.lastCommsLine}
            <span className="inline-block w-1.5 h-3 bg-dr-green/70 ml-0.5 animate-pulse" />
          </div>
        </div>
      )}
    </div>
  );
}

function CampaignCard({
  campaign,
}: {
  campaign: WarRoomProps['activeCampaigns'][number];
}) {
  return (
    <div className="border border-dr-border bg-dr-elevated p-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-dr-text font-tactical text-[11px] truncate">
          {campaign.name}
        </span>
        <span className="text-dr-dim font-data text-[10px]">
          {campaign.battlefieldCodename}
        </span>
      </div>
      <div className="space-y-1">
        {campaign.phases.map((phase) => {
          const phaseColor =
            phase.status === 'secured'
              ? 'bg-dr-green'
              : phase.status === 'active'
                ? 'bg-dr-amber'
                : 'bg-dr-dim/30';
          return (
            <div key={phase.id} className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-dr-bg overflow-hidden">
                <div
                  className={`h-full ${phaseColor} transition-all duration-500`}
                  style={{
                    width:
                      phase.status === 'secured'
                        ? '100%'
                        : phase.status === 'active'
                          ? '50%'
                          : '0%',
                    boxShadow:
                      phase.status === 'active'
                        ? '0 0 6px rgba(255, 191, 0, 0.3)'
                        : phase.status === 'secured'
                          ? '0 0 6px rgba(0, 255, 65, 0.3)'
                          : 'none',
                  }}
                />
              </div>
              <span className="text-dr-dim font-data text-[9px] w-12 text-right truncate">
                {phase.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
