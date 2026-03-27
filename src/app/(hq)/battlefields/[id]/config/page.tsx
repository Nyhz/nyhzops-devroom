import { notFound } from 'next/navigation';
import { getBattlefield } from '@/actions/battlefield';
import { ConfigForm } from '@/components/config/config-form';

export default async function ConfigPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const battlefield = await getBattlefield(id);

  if (!battlefield) {
    notFound();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="text-dr-dim font-tactical text-xs tracking-wider mb-1">
          {battlefield.codename} // SETTINGS
        </div>
        <h1 className="text-dr-amber font-tactical text-lg tracking-wider uppercase">
          Configuration
        </h1>
      </div>

      {/* Config form */}
      <ConfigForm
        id={battlefield.id}
        name={battlefield.name}
        codename={battlefield.codename}
        description={battlefield.description}
        initialBriefing={battlefield.initialBriefing}
        defaultBranch={battlefield.defaultBranch}
        devServerCommand={battlefield.devServerCommand}
        autoStartDevServer={battlefield.autoStartDevServer}
        repoPath={battlefield.repoPath}
        claudeMdPath={battlefield.claudeMdPath}
        specMdPath={battlefield.specMdPath}
      />
    </div>
  );
}
