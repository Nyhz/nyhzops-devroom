import { asc } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { assets } from '@/lib/db/schema';
import { AssetList } from '@/components/asset/asset-list';
import { PageWrapper } from '@/components/layout/page-wrapper';
import { RulesOfEngagementEditor } from '@/components/settings/rules-of-engagement-editor';
import { getRulesOfEngagementAction } from '@/actions/settings';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { Asset } from '@/types';

export default async function AssetsPage() {
  const db = getDatabase();
  const allAssets = db.select().from(assets).orderBy(asc(assets.createdAt)).all() as Asset[];
  const missionAssets = allAssets.filter(a => !a.isSystem);
  const systemAssets = allAssets.filter(a => a.isSystem);
  const roe = await getRulesOfEngagementAction();

  return (
    <PageWrapper
      breadcrumb={['NYHZ OPS', 'ASSETS']}
      title="AGENT ROSTER"
    >
      <Tabs defaultValue="roster">
        <TabsList
          variant="line"
          className="border-b border-dr-border bg-transparent rounded-none p-0 overflow-x-auto flex-nowrap"
        >
          <TabsTrigger
            value="roster"
            className="text-dr-muted text-xs font-tactical tracking-wider rounded-none border-none px-4 py-2 data-active:text-dr-amber data-active:bg-transparent hover:text-dr-text"
          >
            ROSTER
          </TabsTrigger>
          <TabsTrigger
            value="roe"
            className="text-dr-muted text-xs font-tactical tracking-wider rounded-none border-none px-4 py-2 data-active:text-dr-amber data-active:bg-transparent hover:text-dr-text"
          >
            RULES OF ENGAGEMENT
          </TabsTrigger>
        </TabsList>

        <TabsContent value="roster" className="pt-6">
          <div className="space-y-8">
            <AssetList title="MISSION ASSETS" assets={missionAssets} showSystemBadge={false} />
            <AssetList title="SYSTEM ASSETS" assets={systemAssets} showSystemBadge={true} />
          </div>
        </TabsContent>

        <TabsContent value="roe" className="pt-6">
          <RulesOfEngagementEditor initialValue={roe.value} initialUpdatedAt={roe.updatedAt} />
        </TabsContent>
      </Tabs>
    </PageWrapper>
  );
}
