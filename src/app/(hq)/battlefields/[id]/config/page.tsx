import { notFound } from 'next/navigation';
import { PageWrapper } from '@/components/layout/page-wrapper';
import { getBattlefield } from '@/actions/battlefield';
import { ConfigTabs } from '@/components/config/config-tabs';
import type { GateManifest } from '@/control/gates';

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

  const gateManifest: GateManifest | null = battlefield.gateManifest
    ? (JSON.parse(battlefield.gateManifest) as GateManifest)
    : null;

  return (
    <PageWrapper
      breadcrumb={[battlefield.codename, 'CONFIG']}
      title="CONFIG"
    >
      <ConfigTabs
        battlefieldId={battlefield.id}
        profile={{
          name: battlefield.name,
          codename: battlefield.codename,
          description: battlefield.description,
          initialBriefing: battlefield.initialBriefing,
          defaultBranch: battlefield.defaultBranch,
          devServerCommand: battlefield.devServerCommand,
          autoStartDevServer: battlefield.autoStartDevServer,
          repoPath: battlefield.repoPath,
          claudeMdPath: battlefield.claudeMdPath,
          specMdPath: battlefield.specMdPath,
        }}
        gateManifest={gateManifest}
        needsGateManifest={battlefield.needsGateManifest === 1}
        overrideEnabled={battlefield.overrideMainRedGuard === 1}
      />
    </PageWrapper>
  );
}
