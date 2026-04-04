import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { battlefields } from '@/lib/db/schema';
import {
  getActiveProcesses,
  getResourceUsage,
  getRecentExits,
  getServiceHealth,
} from '@/actions/telemetry';
import { ActiveProcesses } from '@/components/telemetry/active-processes';
import { ResourceUsage } from '@/components/telemetry/resource-usage';
import { RecentExits } from '@/components/telemetry/recent-exits';
import { ServiceHealth } from '@/components/telemetry/service-health';
import { PageWrapper } from '@/components/layout/page-wrapper';

export default async function TelemetryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [processes, resources, exits, health] = await Promise.all([
    getActiveProcesses(id),
    getResourceUsage(id),
    getRecentExits(id),
    getServiceHealth(id),
  ]);

  const db = getDatabase();
  const bf = db
    .select({ codename: battlefields.codename })
    .from(battlefields)
    .where(eq(battlefields.id, id))
    .get();

  return (
    <PageWrapper
      breadcrumb={[bf?.codename ?? '', 'TELEMETRY']}
      title="TELEMETRY"
      className="space-y-4"
    >
      <ActiveProcesses
        battlefieldId={id}
        initialProcesses={processes}
      />
      <ResourceUsage metrics={resources} />
      <RecentExits battlefieldId={id} initialExits={exits} />
      <ServiceHealth health={health} />
    </PageWrapper>
  );
}
