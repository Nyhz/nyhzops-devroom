import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getBattlefield } from '@/actions/battlefield';
import { PageWrapper } from '@/components/layout/page-wrapper';
import { GateManifestEditor } from './GateManifestEditor';
import { MainRedOverrideToggle } from './MainRedOverrideToggle';
import { ForensicPruneForm } from './ForensicPruneForm';
import type { GateManifest } from '@/control/gates';

export default async function BattlefieldSettingsPage({
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
      breadcrumb={[battlefield.codename, 'SETTINGS']}
      title={`BATTLEFIELD SETTINGS — ${battlefield.codename}`}
    >
      {/* Back link */}
      <Link
        href={`/battlefields/${id}`}
        className="inline-flex items-center gap-2 text-xs font-tactical uppercase tracking-wider text-dr-dim hover:text-dr-amber transition-colors"
      >
        ← Back to {battlefield.codename}
      </Link>

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
