import { CreateBattlefield } from '@/components/battlefield/create-battlefield';
import { config } from '@/lib/config';
import { PageWrapper } from '@/components/layout/page-wrapper';

export default function NewBattlefieldPage() {
  return (
    <PageWrapper maxWidth>
      <div className="text-dr-muted text-xs mb-1">Battlefields //</div>
      <h1 className="text-dr-amber text-xl font-tactical tracking-wider mb-6">
        NEW BATTLEFIELD
      </h1>
      <CreateBattlefield devBasePath={config.devBasePath} />
    </PageWrapper>
  );
}
