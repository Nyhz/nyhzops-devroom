import { CreateBattlefield } from '@/components/battlefield/create-battlefield';
import { config } from '@/lib/config';

export default function NewBattlefieldPage() {
  return (
    <div className="p-6 max-w-2xl">
      <div className="text-dr-muted text-xs mb-1">Battlefields //</div>
      <h1 className="text-dr-amber text-xl font-tactical tracking-wider mb-6">
        NEW BATTLEFIELD
      </h1>
      <CreateBattlefield devBasePath={config.devBasePath} />
    </div>
  );
}
