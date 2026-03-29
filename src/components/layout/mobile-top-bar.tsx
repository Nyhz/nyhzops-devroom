'use client';

import Link from 'next/link';
import { useNotifications } from '@/hooks/use-notifications';

interface MobileTopBarProps {
  onMenuToggle: () => void;
  battlefieldName?: string;
}

export function MobileTopBar({ onMenuToggle, battlefieldName }: MobileTopBarProps) {
  const { unreadCount } = useNotifications();

  return (
    <header className="sticky top-0 z-40 bg-dr-surface border-b border-dr-border px-4 py-2.5 flex items-center gap-3 md:hidden">
      {/* Hamburger button */}
      <button
        type="button"
        onClick={onMenuToggle}
        className="flex flex-col justify-center items-center gap-1 w-[44px] h-[44px] shrink-0 -ml-2"
        aria-label="Toggle menu"
      >
        <span className="block w-full h-0.5 bg-dr-text" />
        <span className="block w-full h-0.5 bg-dr-text" />
        <span className="block w-full h-0.5 bg-dr-text" />
      </button>

      {/* Battlefield codename */}
      <span className="text-dr-amber text-sm font-bold truncate font-mono uppercase tracking-wider">
        {battlefieldName || 'DEVROOM'}
      </span>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Notification indicator */}
      <Link
        href="/notifications"
        className="relative shrink-0 flex items-center justify-center min-w-[44px] min-h-[44px] -mr-2"
        aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-5 h-5 text-dr-muted"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-4 h-4 px-1 text-[10px] font-bold bg-dr-red text-white rounded-full">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Link>
    </header>
  );
}
