import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { battlefields } from '@/lib/db/schema';
import { detectTestFramework, getLatestTestRun, getTestHistory } from '@/actions/tests';
import { TestRunner } from '@/components/tests/test-runner';
import { TestHistory } from '@/components/tests/test-history';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PageWrapper } from '@/components/layout/page-wrapper';

export default async function TestsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [framework, latestRun, history] = await Promise.all([
    detectTestFramework(id),
    getLatestTestRun(id),
    getTestHistory(id),
  ]);

  const db = getDatabase();
  const bf = db
    .select({ codename: battlefields.codename })
    .from(battlefields)
    .where(eq(battlefields.id, id))
    .get();

  const subtitle = framework
    ? `Framework: ${framework}`
    : 'No test framework detected';

  return (
    <PageWrapper
      breadcrumb={[bf?.codename ?? '', 'TESTS']}
      title="TESTS"
      className="space-y-4"
    >
      <p className="text-dr-dim text-xs font-tactical -mt-4">
        {subtitle}
      </p>

      <Tabs defaultValue="runner">
        <TabsList
          variant="line"
          className="border-b border-dr-border bg-transparent rounded-none p-0 overflow-x-auto flex-nowrap"
        >
          <TabsTrigger
            value="runner"
            className="text-dr-muted text-xs font-tactical tracking-wider rounded-none border-none px-4 py-2 data-active:text-dr-amber data-active:bg-transparent hover:text-dr-text"
          >
            RUNNER
          </TabsTrigger>
          <TabsTrigger
            value="history"
            className="text-dr-muted text-xs font-tactical tracking-wider rounded-none border-none px-4 py-2 data-active:text-dr-amber data-active:bg-transparent hover:text-dr-text"
          >
            HISTORY
          </TabsTrigger>
        </TabsList>

        <TabsContent value="runner" className="pt-4">
          {framework ? (
            <TestRunner
              battlefieldId={id}
              framework={framework}
              latestRun={latestRun ?? undefined}
            />
          ) : (
            <div className="border border-dr-border bg-dr-surface p-6 space-y-3">
              <p className="text-dr-text text-sm font-mono">
                No supported test framework detected in package.json.
              </p>
              <p className="text-dr-dim text-xs font-mono">
                Supported frameworks:
              </p>
              <ul className="text-dr-muted text-xs font-mono space-y-1 pl-4">
                <li>- Vitest</li>
                <li>- Jest</li>
                <li>- Playwright</li>
                <li>- Mocha</li>
              </ul>
              <p className="text-dr-dim text-xs font-mono">
                Install one of these as a devDependency to enable the test runner.
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="pt-4">
          <TestHistory battlefieldId={id} initialHistory={history} />
        </TabsContent>
      </Tabs>
    </PageWrapper>
  );
}
