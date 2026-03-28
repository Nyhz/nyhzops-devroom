import { notFound } from 'next/navigation';
import { getDatabase } from '@/lib/db/index';
import { battlefields } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getAssetDeployment } from '@/actions/asset';
import { AssetDeployment } from '@/components/asset/asset-deployment';
import type { Battlefield } from '@/types';

export default async function BattlefieldLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDatabase();

  const battlefield = db
    .select()
    .from(battlefields)
    .where(eq(battlefields.id, id))
    .get() as Battlefield | undefined;

  if (!battlefield) {
    notFound();
  }

  const initialDeployment = await getAssetDeployment();

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>

      {/* Right sidebar — asset deployment */}
      <aside className="w-[300px] border-l border-dr-border bg-dr-surface flex flex-col overflow-y-auto shrink-0">
        <AssetDeployment initialData={initialDeployment} />
      </aside>
    </div>
  );
}
