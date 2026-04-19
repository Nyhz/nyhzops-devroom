import { getDatabase } from '@/lib/db';
import { managedApps } from '@/lib/db/schema';
import { updateManagedAppForm, rescan } from '@/actions/ops-settings';

type AppRow = typeof managedApps.$inferSelect;

export const dynamic = 'force-dynamic';

export default function OpsSettings() {
  const apps = getDatabase().select().from(managedApps).all() as AppRow[];
  return (
    <div className="p-6 font-mono">
      <h1 className="text-amber-500 tracking-widest mb-4">OPS :: SETTINGS</h1>
      <form action={rescan}>
        <button className="border border-amber-500 text-amber-500 px-3 py-1 mb-6">RE-SCAN</button>
      </form>
      <div className="space-y-6">
        {apps.map((a) => {
          const boundAction = updateManagedAppForm.bind(null, a.slug);
          return (
            <form
              key={a.slug}
              action={boundAction}
              className="border border-zinc-800 p-3 space-y-2 text-xs"
            >
              <div className="text-amber-500">
                {a.slug.toUpperCase()}{a.isSelfControlled ? ' (self)' : ''}
              </div>
              {(['displayName', 'ctlScriptPath', 'logPath', 'healthUrl', 'orderIdx'] as const).map((f) => (
                <label key={f} className="block">
                  <span className="text-zinc-500">{f}</span>
                  <input
                    name={f}
                    defaultValue={String(a[f] ?? '')}
                    className="block w-full bg-black border border-zinc-700 px-2 py-1 text-green-400"
                  />
                </label>
              ))}
              <button className="border border-amber-500 text-amber-500 px-3 py-1">SAVE</button>
            </form>
          );
        })}
      </div>
    </div>
  );
}
