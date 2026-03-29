import Link from 'next/link';
import { getNotifications, markAllRead } from '@/actions/notification';
import { formatRelativeTime } from '@/lib/utils';
import { TacCard } from '@/components/ui/tac-card';
import { TacButton } from '@/components/ui/tac-button';
import { PageWrapper } from '@/components/layout/page-wrapper';
import type { Notification } from '@/types';

function levelIcon(level: string): string {
  switch (level) {
    case 'critical': return '\u{1F6A8}';
    case 'warning': return '\u26A0\uFE0F';
    default: return '\u2139\uFE0F';
  }
}

function levelColor(level: string): string {
  switch (level) {
    case 'critical': return 'text-dr-red';
    case 'warning': return 'text-dr-amber';
    default: return 'text-dr-dim';
  }
}

function entityLink(n: Notification): string | null {
  if (!n.entityType || !n.entityId) return null;
  if (!n.battlefieldId) return null;

  switch (n.entityType) {
    case 'mission':
      return `/battlefields/${n.battlefieldId}/missions/${n.entityId}`;
    case 'campaign':
      return `/battlefields/${n.battlefieldId}/campaigns/${n.entityId}`;
    default:
      return null;
  }
}

export default async function NotificationsPage() {
  const notifications = await getNotifications(100);

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-tactical text-dr-amber tracking-wider">NOTIFICATIONS</h1>
        <form action={async () => {
          'use server';
          await markAllRead();
          const { revalidatePath } = await import('next/cache');
          revalidatePath('/notifications');
        }}>
          <TacButton type="submit" variant="ghost" size="sm">
            MARK ALL READ
          </TacButton>
        </form>
      </div>

      {notifications.length === 0 ? (
        <TacCard className="p-8 text-center">
          <p className="text-dr-muted text-sm">Radio silence. No notifications.</p>
        </TacCard>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => {
            const link = entityLink(n);
            const content = (
              <TacCard
                key={n.id}
                className={`p-3 sm:p-4 transition-colors ${!n.read ? 'border-dr-amber/30' : ''} ${link ? 'hover:bg-dr-elevated cursor-pointer' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-base flex-shrink-0 mt-0.5">
                    {levelIcon(n.level)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-bold ${levelColor(n.level)}`}>
                        {n.title}
                      </span>
                      {!n.read && (
                        <span className="w-2 h-2 bg-dr-amber rounded-full flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-dr-muted mt-1 line-clamp-2">
                      {n.detail}
                    </p>
                    <span className="text-xs text-dr-dim mt-1 block">
                      {formatRelativeTime(n.createdAt)}
                    </span>
                  </div>
                </div>
              </TacCard>
            );

            return link ? (
              <Link key={n.id} href={link} className="block">
                {content}
              </Link>
            ) : (
              <div key={n.id}>{content}</div>
            );
          })}
        </div>
      )}
    </PageWrapper>
  );
}
