import { getBattlefield } from '@/actions/battlefield';
import { getDevServerStatus, getPackageScripts, getCommandHistory } from '@/actions/console';
import { DevServerPanel } from '@/components/console/dev-server-panel';
import { QuickCommands } from '@/components/console/quick-commands';
import { CommandOutput } from '@/components/console/command-output';

export default async function ConsolePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [battlefield, devStatus, scripts, history] = await Promise.all([
    getBattlefield(id),
    getDevServerStatus(id),
    getPackageScripts(id),
    getCommandHistory(id),
  ]);

  const devCommand = battlefield?.devServerCommand ?? 'npm run dev';

  return (
    <div className="space-y-6">
      {/* Dev Server Section */}
      <div className="space-y-2">
        <h2 className="text-dr-amber text-sm font-tactical tracking-wider">
          DEV SERVER
        </h2>
        <DevServerPanel
          battlefieldId={id}
          initialStatus={devStatus}
          devCommand={devCommand}
        />
      </div>

      {/* Quick Commands Section */}
      <div className="space-y-2">
        <h2 className="text-dr-amber text-sm font-tactical tracking-wider">
          QUICK COMMANDS
        </h2>
        <QuickCommands battlefieldId={id} scripts={scripts} />
      </div>

      {/* Output Section */}
      <div className="space-y-2">
        <h2 className="text-dr-amber text-sm font-tactical tracking-wider">
          OUTPUT
        </h2>
        <CommandOutput battlefieldId={id} commandHistory={history} />
      </div>
    </div>
  );
}
