import { getGitStatus, getGitLog, getBranches } from '@/actions/git';
import { GitStatus } from '@/components/git/git-status';
import { GitLog } from '@/components/git/git-log';
import { GitBranches } from '@/components/git/git-branches';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-dr-amber text-sm font-tactical tracking-wider">
            GIT OPERATIONS
          </h1>
          <p className="text-dr-dim text-xs font-tactical mt-1">
            Branch: <span className="text-dr-green">{branches.current}</span>
          </p>
        </div>
      </div>

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
    </div>
  );
}
