import { notFound } from 'next/navigation';
import { PageWrapper } from '@/components/layout/page-wrapper';
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
    <PageWrapper
      breadcrumb={[battlefield.codename, 'CONFIG']}
      title="CONFIG"
    >

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
    </PageWrapper>
  );
}
