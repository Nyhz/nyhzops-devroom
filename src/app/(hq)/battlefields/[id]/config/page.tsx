import { notFound } from 'next/navigation';
import { PageWrapper } from '@/components/layout/page-wrapper';
import { getBattlefield } from '@/actions/battlefield';
import { ConfigForm } from '@/components/config/config-form';
import { GateManifestEditor } from '@/components/config/GateManifestEditor';
import { MainRedOverrideToggle } from '@/components/config/MainRedOverrideToggle';
import { ForensicPruneForm } from '@/components/config/ForensicPruneForm';
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

  const needsGateManifest = battlefield.needsGateManifest === 1;
  const overrideEnabled = battlefield.overrideMainRedGuard === 1;

  return (
    <PageWrapper
      breadcrumb={[battlefield.codename, 'CONFIG']}
      title="CONFIG"
    >
      {/* Gate manifest warning banner */}
      {needsGateManifest && (
        <div className="border border-dr-amber/50 bg-dr-amber/5 p-4 flex items-start gap-3">
          <span className="text-dr-amber text-xs font-tactical uppercase tracking-wider shrink-0">
            ⚠ Gate Manifest Required
          </span>
          <span className="text-xs font-data text-dr-amber/80">
            Gate manifest not configured — run{' '}
            <span className="font-tactical text-dr-amber">AUTO-DETECT (EstablishGates)</span>{' '}
            below or fill in commands manually.
          </span>
        </div>
      )}

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

      {/* Divider */}
      <div className="border-t border-dr-border pt-4">
        <h2 className="text-xs font-tactical uppercase tracking-widest text-dr-dim mb-4">
          Control &amp; Maintenance
        </h2>
      </div>

      {/* Section: Gate Manifest */}
      <section className="space-y-2">
        <GateManifestEditor
          battlefieldId={id}
          initialManifest={gateManifest}
        />
      </section>

      {/* Section: Main-Red Override */}
      <section className="space-y-2">
        <MainRedOverrideToggle
          battlefieldId={id}
          initialEnabled={overrideEnabled}
        />
      </section>

      {/* Section: Forensic Branch Prune */}
      <section className="space-y-2">
        <ForensicPruneForm battlefieldId={id} />
      </section>
    </PageWrapper>
  );
}
