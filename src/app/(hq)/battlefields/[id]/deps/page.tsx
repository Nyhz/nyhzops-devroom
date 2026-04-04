import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { battlefields } from '@/lib/db/schema';
import { detectPackageManager, getDependencies, getOutdatedDeps } from '@/actions/deps';
import { DepsTable } from '@/components/deps/deps-table';
import { DepsInstallForm } from '@/components/deps/deps-install-form';
import { DepsAudit } from '@/components/deps/deps-audit';
import { DepsOutput } from '@/components/deps/deps-output';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PageWrapper } from '@/components/layout/page-wrapper';

export default async function DepsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [pm, depsResult, outdated] = await Promise.all([
    detectPackageManager(id),
    getDependencies(id),
    getOutdatedDeps(id),
  ]);

  const db = getDatabase();
  const bf = db.select({ codename: battlefields.codename }).from(battlefields).where(eq(battlefields.id, id)).get();

  return (
    <PageWrapper
      breadcrumb={[bf?.codename ?? '', 'DEPS']}
      title="DEPS"
      className="space-y-4"
    >
      <p className="text-dr-dim text-xs font-tactical -mt-4">
        Package manager: <span className="text-dr-green">{pm.toUpperCase()}</span>
      </p>

      <Tabs defaultValue="packages">
        <TabsList
          variant="line"
          className="border-b border-dr-border bg-transparent rounded-none p-0 overflow-x-auto flex-nowrap"
        >
          <TabsTrigger
            value="packages"
            className="text-dr-muted text-xs font-tactical tracking-wider rounded-none border-none px-4 py-2 data-active:text-dr-amber data-active:bg-transparent hover:text-dr-text"
          >
            PACKAGES
          </TabsTrigger>
          <TabsTrigger
            value="install"
            className="text-dr-muted text-xs font-tactical tracking-wider rounded-none border-none px-4 py-2 data-active:text-dr-amber data-active:bg-transparent hover:text-dr-text"
          >
            INSTALL
          </TabsTrigger>
          <TabsTrigger
            value="audit"
            className="text-dr-muted text-xs font-tactical tracking-wider rounded-none border-none px-4 py-2 data-active:text-dr-amber data-active:bg-transparent hover:text-dr-text"
          >
            AUDIT
          </TabsTrigger>
          <TabsTrigger
            value="output"
            className="text-dr-muted text-xs font-tactical tracking-wider rounded-none border-none px-4 py-2 data-active:text-dr-amber data-active:bg-transparent hover:text-dr-text"
          >
            OUTPUT
          </TabsTrigger>
        </TabsList>

        <TabsContent value="packages" className="pt-4">
          <DepsTable
            battlefieldId={id}
            initialDeps={depsResult.deps}
            initialDevDeps={depsResult.devDeps}
            initialOutdated={outdated}
          />
        </TabsContent>

        <TabsContent value="install" className="pt-4">
          <DepsInstallForm battlefieldId={id} />
        </TabsContent>

        <TabsContent value="audit" className="pt-4">
          <DepsAudit battlefieldId={id} />
        </TabsContent>

        <TabsContent value="output" className="pt-4">
          <DepsOutput battlefieldId={id} />
        </TabsContent>
      </Tabs>
    </PageWrapper>
  );
}
