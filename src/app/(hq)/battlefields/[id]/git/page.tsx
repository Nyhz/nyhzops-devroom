import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { battlefields } from '@/lib/db/schema';
import { getGitStatus, getGitLog, getBranches } from '@/actions/git';
import { GitStatus } from '@/components/git/git-status';
import { GitLog } from '@/components/git/git-log';
import { GitBranches } from '@/components/git/git-branches';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PageWrapper } from '@/components/layout/page-wrapper';

export default async function GitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [status, log, branches] = await Promise.all([
    getGitStatus(id),
    getGitLog(id),
    getBranches(id),
  ]);

  const db = getDatabase();
  const bf = db.select({ codename: battlefields.codename }).from(battlefields).where(eq(battlefields.id, id)).get();

  return (
    <PageWrapper
      breadcrumb={[bf?.codename ?? '', 'GIT']}
      title="GIT"
      className="space-y-4"
    >
      <p className="text-dr-dim text-xs font-tactical -mt-4">
        Branch: <span className="text-dr-green">{branches.current}</span>
      </p>

      <Tabs defaultValue="status">
        <TabsList
          variant="line"
          className="border-b border-dr-border bg-transparent rounded-none p-0"
        >
          <TabsTrigger
            value="status"
            className="text-dr-muted text-xs font-tactical tracking-wider rounded-none border-none px-4 py-2 data-active:text-dr-amber data-active:bg-transparent hover:text-dr-text"
          >
            STATUS
          </TabsTrigger>
          <TabsTrigger
            value="log"
            className="text-dr-muted text-xs font-tactical tracking-wider rounded-none border-none px-4 py-2 data-active:text-dr-amber data-active:bg-transparent hover:text-dr-text"
          >
            LOG
          </TabsTrigger>
          <TabsTrigger
            value="branches"
            className="text-dr-muted text-xs font-tactical tracking-wider rounded-none border-none px-4 py-2 data-active:text-dr-amber data-active:bg-transparent hover:text-dr-text"
          >
            BRANCHES
          </TabsTrigger>
        </TabsList>

        <TabsContent value="status" className="pt-4">
          <GitStatus battlefieldId={id} initialStatus={status} />
        </TabsContent>

        <TabsContent value="log" className="pt-4">
          <GitLog battlefieldId={id} initialCommits={log.commits} />
        </TabsContent>

        <TabsContent value="branches" className="pt-4">
          <GitBranches battlefieldId={id} initialBranches={branches} />
        </TabsContent>
      </Tabs>
    </PageWrapper>
  );
}
