import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { battlefields } from '@/lib/db/schema';
import {
  getWorktreeStatus,
  getBranchHygiene,
  getQuartermasterLog,
  getRepoVitals,
} from '@/actions/field-check';
import { WorktreeBoard } from '@/components/field-check/worktree-board';
import { BranchHygiene } from '@/components/field-check/branch-hygiene';
import { QuartermasterLog } from '@/components/field-check/quartermaster-log';
import { RepoVitals } from '@/components/field-check/repo-vitals';
import { PageWrapper } from '@/components/layout/page-wrapper';

export default async function FieldCheckPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [worktrees, hygiene, qmLog, vitals] = await Promise.all([
    getWorktreeStatus(id),
    getBranchHygiene(id),
    getQuartermasterLog(id),
    getRepoVitals(id),
  ]);

  const db = getDatabase();
  const bf = db
    .select({ codename: battlefields.codename })
    .from(battlefields)
    .where(eq(battlefields.id, id))
    .get();

  return (
    <PageWrapper
      breadcrumb={[bf?.codename ?? '', 'FIELD CHECK']}
      title="FIELD CHECK"
      className="space-y-4"
    >
      <WorktreeBoard battlefieldId={id} initialWorktrees={worktrees} />
      <BranchHygiene battlefieldId={id} initialData={hygiene} />
      <QuartermasterLog entries={qmLog} battlefieldId={id} />
      <RepoVitals vitals={vitals} />
    </PageWrapper>
  );
}
