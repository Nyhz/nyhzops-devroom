interface StatsBarProps {
  inCombat: number;
  accomplished: number;
  compromised: number;
  standby: number;
  abandoned: number;
}

export function StatsBar({
  inCombat,
  accomplished,
  compromised,
  standby,
  abandoned,
}: StatsBarProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 bg-dr-border gap-px">
      <div className="bg-dr-surface p-3 md:p-5 text-center">
        <div className="text-dr-amber font-tactical text-4xl">{inCombat}</div>
        <div className="text-dr-muted font-tactical text-sm tracking-wider uppercase mt-1">
          IN COMBAT
        </div>
      </div>
      <div className="bg-dr-surface p-3 md:p-5 text-center">
        <div className="text-dr-green font-tactical text-4xl">{accomplished}</div>
        <div className="text-dr-muted font-tactical text-sm tracking-wider uppercase mt-1">
          ACCOMPLISHED
        </div>
      </div>
      <div className="bg-dr-surface p-3 md:p-5 text-center">
        <div className="text-dr-red font-tactical text-4xl">{compromised}</div>
        <div className="text-dr-muted font-tactical text-sm tracking-wider uppercase mt-1">
          COMPROMISED
        </div>
      </div>
      <div className="bg-dr-surface p-3 md:p-5 text-center">
        <div className="text-dr-dim font-tactical text-4xl">{standby}</div>
        <div className="text-dr-muted font-tactical text-sm tracking-wider uppercase mt-1">
          STANDBY
        </div>
      </div>
      <div className="col-span-2 md:col-span-1 bg-dr-surface p-3 md:p-5 text-center">
        <div className="text-dr-dim font-tactical text-4xl">{abandoned}</div>
        <div className="text-dr-muted font-tactical text-sm tracking-wider uppercase mt-1">
          ABANDONED
        </div>
      </div>
    </div>
  );
}
