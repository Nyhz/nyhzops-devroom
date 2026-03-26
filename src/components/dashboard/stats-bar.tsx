interface StatsBarProps {
  inCombat: number;
  accomplished: number;
  compromised: number;
  standby: number;
  cacheHitPercent: string;
}

export function StatsBar({
  inCombat,
  accomplished,
  compromised,
  standby,
  cacheHitPercent,
}: StatsBarProps) {
  return (
    <div className="flex bg-dr-border gap-px">
      <div className="flex-1 bg-dr-surface p-3 text-center">
        <div className="text-dr-amber font-tactical text-lg">{inCombat}</div>
        <div className="text-dr-muted font-tactical text-[10px] tracking-wider uppercase">
          IN COMBAT
        </div>
      </div>
      <div className="flex-1 bg-dr-surface p-3 text-center">
        <div className="text-dr-green font-tactical text-lg">{accomplished}</div>
        <div className="text-dr-muted font-tactical text-[10px] tracking-wider uppercase">
          ACCOMPLISHED
        </div>
      </div>
      <div className="flex-1 bg-dr-surface p-3 text-center">
        <div className="text-dr-red font-tactical text-lg">{compromised}</div>
        <div className="text-dr-muted font-tactical text-[10px] tracking-wider uppercase">
          COMPROMISED
        </div>
      </div>
      <div className="flex-1 bg-dr-surface p-3 text-center">
        <div className="text-dr-dim font-tactical text-lg">{standby}</div>
        <div className="text-dr-muted font-tactical text-[10px] tracking-wider uppercase">
          STANDBY
        </div>
      </div>
      <div className="flex-1 bg-dr-surface p-3 text-center">
        <div className="text-dr-green font-tactical text-lg">{cacheHitPercent}</div>
        <div className="text-dr-muted font-tactical text-[10px] tracking-wider uppercase">
          CACHE HIT
        </div>
      </div>
    </div>
  );
}
