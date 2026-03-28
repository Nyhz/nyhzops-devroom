import { CreateBattlefield } from '@/components/battlefield/create-battlefield';
import { config } from '@/lib/config';
import { PageWrapper } from '@/components/layout/page-wrapper';

export default function NewBattlefieldPage() {
  return (
    <PageWrapper maxWidth breadcrumb={['HQ', 'BATTLEFIELDS']} title="NEW BATTLEFIELD">
      <CreateBattlefield devBasePath={config.devBasePath} />
    </PageWrapper>
  );
}
