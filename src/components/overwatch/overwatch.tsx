'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useSocket } from '@/hooks/use-socket';
import { useActivityFeed, type ActivityEvent } from '@/hooks/use-activity-feed';
import { BootSequence } from '@/components/warroom/boot-sequence';
import { formatRelativeTime } from '@/lib/utils';
import type {
  OverwatchStats,
  OverwatchMission,
  OverwatchCampaign,
  OverwatchAsset,
  OverwatchCaptainLog,
  OverwatchBattlefieldSummary,
} from '@/app/overwatch/page';

// ---------------------------------------------------------------------------
// Sound effects via Web Audio API
// ---------------------------------------------------------------------------
function playTone(frequency: number, duration: number, type: OscillatorType = 'sine') {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.value = 0.1;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.stop(ctx.currentTime + duration);
  } catch {
    // AudioContext may not be available
  }
}

function playAccomplished() {
  playTone(880, 0.1);
  setTimeout(() => playTone(1100, 0.15), 120);
}

function playCompromised() {
  playTone(220, 0.3, 'sawtooth');
}

function playEscalation() {
  playTone(660, 0.1);
  setTimeout(() => playTone(880, 0.1), 100);
  setTimeout(() => playTone(1100, 0.15), 200);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface OverwatchProps {
  stats: OverwatchStats;
  missions: OverwatchMission[];
  campaigns: OverwatchCampaign[];
  assetDeployment: OverwatchAsset[];
  captainLogs: OverwatchCaptainLog[];
  battlefieldSummaries: OverwatchBattlefieldSummary[];
}

// ---------------------------------------------------------------------------
// Clock hook
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
// Comms log entry
// ---------------------------------------------------------------------------
interface CommsEntry {
  id: string;
  missionTitle: string;
  content: string;
  type: 'log' | 'status' | 'accomplished' | 'compromised';
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Main OVERWATCH Component
// ---------------------------------------------------------------------------
export function Overwatch(props: OverwatchProps) {
  const [booted, setBooted] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem('devroom-booted') === 'true') {
      setBooted(true);
    }
    setChecked(true);
  }, []);

  const handleBootComplete = useCallback(() => {
    setBooted(true);
    sessionStorage.setItem('devroom-booted', 'true');
  }, []);

  if (!checked) return null;

  if (!booted) {
    return (
      <BootSequence
        battlefieldCount={props.stats.totalBattlefields}
        inCombatCount={props.stats.inCombat}
        onComplete={handleBootComplete}
      />
    );
  }

  return <OverwatchDashboard {...props} />;
}

// ---------------------------------------------------------------------------
// Dashboard (post-boot)
// ---------------------------------------------------------------------------
function OverwatchDashboard({
  stats: initialStats,
  missions: initialMissions,
  campaigns: initialCampaigns,
  assetDeployment: initialAssets,
  captainLogs: initialCaptainLogs,
  battlefieldSummaries,
}: OverwatchProps) {
  const clock = useClock();
  const socket = useSocket();
  const events = useActivityFeed();

  // Live state
  const [stats, setStats] = useState(initialStats);
  const [liveMissions, setLiveMissions] = useState(initialMissions);
  const [liveAssets, setLiveAssets] = useState(initialAssets);
  const [liveCampaigns, setLiveCampaigns] = useState(initialCampaigns);
  const [captainActivity, setCaptainActivity] = useState(initialCaptainLogs);

  // Multiplexed comms
  const [commsLog, setCommsLog] = useState<CommsEntry[]>([]);
  const commsRef = useRef<HTMLDivElement>(null);
  const commsIdCounter = useRef(0);

  // Flashing metric keys
  const [flashKeys, setFlashKeys] = useState<Set<string>>(new Set());
  const prevStats = useRef(initialStats);

  // Track which mission rooms we're subscribed to
  const subscribedRooms = useRef<Set<string>>(new Set());

  // Detect stat changes and flash
  useEffect(() => {
    const changed = new Set<string>();
    const prev = prevStats.current;
    if (stats.inCombat !== prev.inCombat) changed.add('inCombat');
    if (stats.accomplished !== prev.accomplished) changed.add('accomplished');
    if (stats.compromised !== prev.compromised) changed.add('compromised');
    if (stats.queued !== prev.queued) changed.add('queued');
    if (stats.cacheHitPercent !== prev.cacheHitPercent) changed.add('cache');
    prevStats.current = stats;

    if (changed.size > 0) {
      setFlashKeys(changed);
      const timer = setTimeout(() => setFlashKeys(new Set()), 500);
      return () => clearTimeout(timer);
    }
  }, [stats]);

  // Subscribe to active mission rooms for multiplexed comms
  useEffect(() => {
    if (!socket) return;

    const activeMissionIds = liveMissions
      .filter((m) => m.status === 'in_combat' || m.status === 'deploying')
      .map((m) => m.id);

    // Subscribe to new rooms
    for (const id of activeMissionIds) {
      if (!subscribedRooms.current.has(id)) {
        socket.emit('mission:subscribe', id);
        subscribedRooms.current.add(id);
      }
    }

    // Unsubscribe from finished rooms
    for (const id of subscribedRooms.current) {
      if (!activeMissionIds.includes(id)) {
        socket.emit('mission:unsubscribe', id);
        subscribedRooms.current.delete(id);
      }
    }
  }, [socket, liveMissions]);

  // Socket.IO event handlers
  useEffect(() => {
    if (!socket) return;

    // Mission log — multiplexed comms
    const handleLog = (data: { missionId: string; timestamp: number; type: string; content: string }) => {
      const mission = liveMissions.find((m) => m.id === data.missionId);
      const title = mission?.title ?? data.missionId.slice(0, 8);
      commsIdCounter.current += 1;
      setCommsLog((prev) => {
        const next = [
          ...prev,
          {
            id: `comms-${commsIdCounter.current}`,
            missionTitle: title,
            content: data.content,
            type: 'log' as const,
            timestamp: data.timestamp,
          },
        ];
        // Keep last 200 lines
        return next.length > 200 ? next.slice(next.length - 200) : next;
      });
    };

    // Mission status changes
    const handleStatus = (data: { missionId: string; status: string }) => {
      setLiveMissions((prev) =>
        prev.map((m) => (m.id === data.missionId ? { ...m, status: data.status } : m)),
      );

      // Update stats
      setStats((prev) => {
        const updated = { ...prev };
        if (data.status === 'in_combat' || data.status === 'deploying') {
          updated.inCombat = prev.inCombat + 1;
          updated.queued = Math.max(0, prev.queued - 1);
        } else if (data.status === 'accomplished') {
          updated.inCombat = Math.max(0, prev.inCombat - 1);
          updated.accomplished = prev.accomplished + 1;
          playAccomplished();
        } else if (data.status === 'compromised') {
          updated.inCombat = Math.max(0, prev.inCombat - 1);
          updated.compromised = prev.compromised + 1;
          playCompromised();
        } else if (data.status === 'queued') {
          updated.queued = prev.queued + 1;
        }
        return updated;
      });

      // Add completion entries to comms
      const mission = liveMissions.find((m) => m.id === data.missionId);
      const title = mission?.title ?? data.missionId.slice(0, 8);
      if (data.status === 'accomplished' || data.status === 'compromised') {
        commsIdCounter.current += 1;
        setCommsLog((prev) => [
          ...prev,
          {
            id: `comms-${commsIdCounter.current}`,
            missionTitle: title,
            content: data.status === 'accomplished' ? 'MISSION ACCOMPLISHED' : 'MISSION COMPROMISED',
            type: data.status as 'accomplished' | 'compromised',
            timestamp: Date.now(),
          },
        ]);
      }
    };

    // Captain escalation
    const handleActivity = (event: ActivityEvent) => {
      if (event.type.includes('captain') || event.type.includes('escalat')) {
        playEscalation();
      }
    };

    socket.on('mission:log', handleLog);
    socket.on('mission:status', handleStatus);
    socket.on('activity:event', handleActivity);

    return () => {
      socket.off('mission:log', handleLog);
      socket.off('mission:status', handleStatus);
      socket.off('activity:event', handleActivity);
    };
  }, [socket, liveMissions]);

  // Auto-scroll comms
  useEffect(() => {
    if (commsRef.current) {
      commsRef.current.scrollTop = commsRef.current.scrollHeight;
    }
  }, [commsLog]);

  const timeStr = clock.toLocaleTimeString('en-US', { hour12: false });
  const dateStr = clock.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="flex flex-col h-screen w-screen bg-dr-bg overflow-hidden">
      {/* ── Top Bar ────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-2.5 border-b border-dr-border bg-dr-surface shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-dr-amber font-tactical text-sm tracking-[0.3em] uppercase">
            &#9673; OVERWATCH
          </span>
          <span className="text-dr-dim font-tactical text-sm tracking-wider">
            NYHZ OPS &mdash; DEVROOM
          </span>
        </div>
        <div className="flex items-center gap-6">
          <span className="text-dr-muted font-data text-sm">
            {dateStr} {timeStr}
          </span>
          <Link
            href="/"
            className="text-dr-amber font-tactical text-sm tracking-wider hover:text-dr-green transition-colors"
          >
            ENTER HQ &rarr;
          </Link>
        </div>
      </header>

      {/* ── Main Content ───────────────────────────────────────── */}
      <div className="flex-1 grid grid-cols-[200px_1fr_300px] min-h-0">
        {/* Left Column: Live Metrics */}
        <aside className="border-r border-dr-border bg-dr-surface flex flex-col justify-center px-5 py-6 gap-8">
          <MetricDisplay
            label="AGENTS"
            value={`${stats.inCombat}/${stats.maxAgents}`}
            color={stats.inCombat > 0 ? 'text-dr-amber' : 'text-dr-green'}
            flash={flashKeys.has('inCombat')}
            dotColor={stats.inCombat > 0 ? 'bg-dr-amber' : 'bg-dr-green'}
          />
          <MetricDisplay
            label="QUEUED"
            value={String(stats.queued)}
            color="text-dr-blue"
            flash={flashKeys.has('queued')}
            dotColor="bg-dr-blue"
          />
          <MetricDisplay
            label="ACCOMPLISHED"
            value={String(stats.accomplished)}
            color="text-dr-green"
            flash={flashKeys.has('accomplished')}
            dotColor="bg-dr-green"
          />
          <MetricDisplay
            label="COMPROMISED"
            value={String(stats.compromised)}
            color="text-dr-red"
            flash={flashKeys.has('compromised')}
            dotColor="bg-dr-red"
          />
          <MetricDisplay
            label="CACHE HIT"
            value={`${stats.cacheHitPercent}%`}
            color="text-dr-muted"
            flash={flashKeys.has('cache')}
            dotColor="bg-dr-dim"
          />
        </aside>

        {/* Center: Multiplexed Comms */}
        <main className="flex flex-col min-h-0">
          <div className="px-6 py-3 border-b border-dr-border flex items-center justify-between shrink-0">
            <span className="text-dr-amber font-tactical text-sm tracking-widest uppercase">
              MULTIPLEXED COMMS
            </span>
            <span className="text-dr-dim font-data text-sm">
              {liveMissions.filter((m) => m.status === 'in_combat' || m.status === 'deploying').length} active streams
            </span>
          </div>
          <div
            ref={commsRef}
            className="flex-1 overflow-y-auto bg-dr-bg p-4 font-data text-sm"
          >
            {commsLog.length === 0 && (
              <div className="text-dr-dim text-center py-12">
                Awaiting mission comms...
                <span className="inline-block w-1.5 h-3 bg-dr-green/70 ml-1 animate-pulse" />
              </div>
            )}
            {commsLog.map((entry) => (
              <CommsLine key={entry.id} entry={entry} />
            ))}
          </div>
        </main>

        {/* Right Column: Status Panels */}
        <aside className="border-l border-dr-border bg-dr-surface overflow-y-auto">
          {/* Campaign Progress */}
          <div className="px-4 py-3 border-b border-dr-border">
            <span className="text-dr-amber font-tactical text-sm tracking-widest uppercase">
              CAMPAIGN PROGRESS
            </span>
          </div>
          <div className="p-4 space-y-3">
            {liveCampaigns.length === 0 && (
              <div className="text-dr-dim font-data text-xs text-center py-4">
                No active campaigns
              </div>
            )}
            {liveCampaigns.map((campaign) => (
              <CampaignProgress key={campaign.id} campaign={campaign} />
            ))}
          </div>

          {/* Captain Activity */}
          <div className="px-4 py-3 border-b border-t border-dr-border">
            <span className="text-dr-amber font-tactical text-sm tracking-widest uppercase">
              CAPTAIN ACTIVITY
            </span>
          </div>
          <div className="p-4 space-y-2">
            {captainActivity.length === 0 && events.length === 0 && (
              <div className="text-dr-dim font-data text-xs text-center py-4">
                No recent Captain decisions
              </div>
            )}
            {captainActivity.slice(0, 5).map((log) => (
              <div key={log.id} className="py-2 border-b border-dr-border/50">
                <div className="text-dr-muted font-data text-xs">
                  <span className={log.escalated ? 'text-dr-red' : 'text-dr-amber'}>
                    {log.escalated ? '!' : '\u25CF'}
                  </span>
                  <span className="ml-2">Captain answered:</span>
                </div>
                <div className="text-dr-text font-data text-xs mt-1 truncate">
                  {log.answer.length > 80 ? log.answer.slice(0, 80) + '...' : log.answer}
                </div>
                <div className="text-dr-dim font-data text-xs mt-0.5 flex items-center gap-2">
                  <span>{log.battlefieldCodename}</span>
                  <span>{formatRelativeTime(log.timestamp)}</span>
                  <span className={
                    log.confidence === 'high' ? 'text-dr-green' :
                    log.confidence === 'medium' ? 'text-dr-amber' :
                    'text-dr-red'
                  }>
                    {log.confidence.toUpperCase()}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Asset Deployment */}
          <div className="px-4 py-3 border-b border-t border-dr-border">
            <span className="text-dr-amber font-tactical text-sm tracking-widest uppercase">
              ASSET DEPLOYMENT
            </span>
          </div>
          <div className="p-4 space-y-2">
            {liveAssets.map((asset) => (
              <div key={asset.id} className="flex items-center gap-3">
                <span
                  className={`text-xs ${
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
                  <div className="text-dr-text font-tactical text-sm">{asset.codename}</div>
                  <div className="text-dr-dim font-data text-xs truncate">
                    {asset.currentStatus === 'idle'
                      ? 'Standing by'
                      : asset.currentMissionTitle ?? asset.currentStatus.toUpperCase()}
                  </div>
                </div>
                <span
                  className={`font-tactical text-xs tracking-wider ${
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
          <div
            key={bf.id}
            className="flex items-center gap-3 px-5 py-2 border-r border-dr-border shrink-0"
          >
            <span className="text-dr-text font-tactical text-sm tracking-wider">
              {bf.codename}
            </span>
            <span className="text-dr-dim font-data text-xs">{bf.missionCount}</span>
            {bf.activeCount > 0 && (
              <span className="text-dr-amber font-tactical text-xs">
                &#9679; {bf.activeCount}
              </span>
            )}
          </div>
        ))}
        {battlefieldSummaries.length === 0 && (
          <div className="px-5 py-2 text-dr-dim font-tactical text-sm">
            No battlefields deployed
          </div>
        )}
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MetricDisplay — big number with label + flash animation
// ---------------------------------------------------------------------------
function MetricDisplay({
  label,
  value,
  color,
  flash,
  dotColor,
}: {
  label: string;
  value: string;
  color: string;
  flash: boolean;
  dotColor: string;
}) {
  return (
    <div className="text-center">
      <div className="flex items-center justify-center gap-2 mb-1">
        <span className={`w-2 h-2 ${dotColor}`} />
      </div>
      <div
        className={`text-3xl font-tactical ${color} transition-all duration-200 ${
          flash ? 'overwatch-flash' : ''
        }`}
      >
        {value}
      </div>
      <div className="text-dr-dim font-tactical text-xs tracking-wider mt-1">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommsLine — single line in multiplexed comms
// ---------------------------------------------------------------------------
function CommsLine({ entry }: { entry: CommsEntry }) {
  if (entry.type === 'accomplished') {
    return (
      <div className="py-0.5">
        <span className="text-dr-green font-tactical">
          &#10003; [{entry.missionTitle}] ACCOMPLISHED
        </span>
      </div>
    );
  }

  if (entry.type === 'compromised') {
    return (
      <div className="py-0.5">
        <span className="text-dr-red font-tactical">
          &#10007; [{entry.missionTitle}] COMPROMISED
        </span>
      </div>
    );
  }

  return (
    <div className="py-0.5 leading-tight">
      <span className="text-dr-amber">[{entry.missionTitle}]</span>{' '}
      <span className="text-dr-text/80">{entry.content}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CampaignProgress — phase progress bars
// ---------------------------------------------------------------------------
function CampaignProgress({ campaign }: { campaign: OverwatchCampaign }) {
  return (
    <div className="border border-dr-border bg-dr-elevated p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-dr-text font-tactical text-sm truncate">{campaign.name}</span>
        <span className="text-dr-dim font-data text-xs">{campaign.battlefieldCodename}</span>
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
