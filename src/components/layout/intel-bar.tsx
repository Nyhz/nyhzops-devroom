"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useNotifications } from "@/hooks/use-notifications";
import { cn, formatRelativeTime } from "@/lib/utils";
import { SystemMonitor } from "@/components/layout/system-monitor";
import type { Notification } from "@/types";

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
    case 'phase':
      return null;
    default:
      return null;
  }
}

export function IntelBar() {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const { notifications, unreadCount, markAsRead, markAllRead } = useNotifications();

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!dropdownOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  const handleNotificationClick = async (n: Notification) => {
    if (!n.read) {
      await markAsRead(n.id);
    }
    const link = entityLink(n);
    if (link) {
      router.push(link);
      setDropdownOpen(false);
    }
  };

  const handleMarkAllRead = async () => {
    await markAllRead();
  };

  return (
    <header className="bg-dr-surface border-b border-dr-border px-6 py-2.5 flex items-center gap-4 min-h-[44px]">
      <SystemMonitor />

      {/* Notification Bell */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen((prev) => !prev)}
          className="flex items-center gap-1 text-xs hover:opacity-80 transition-opacity px-1"
          title="Notifications"
        >
          <span className={unreadCount > 0 ? 'text-dr-amber' : 'text-dr-dim'}>
            {'\u{1F514}'}
          </span>
          {unreadCount > 0 && (
            <span className="text-dr-red font-bold text-xs min-w-[14px] text-center bg-dr-red/20 px-1 rounded-sm">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {/* Dropdown Panel */}
        {dropdownOpen && (
          <div className="absolute right-0 top-full mt-1 w-[calc(100vw-2rem)] sm:w-[380px] bg-dr-surface border border-dr-border shadow-lg z-50 max-h-[420px] flex flex-col">
            <div className="px-3 py-2 border-b border-dr-border flex items-center justify-between">
              <span className="text-dr-amber text-xs font-bold">NOTIFICATIONS</span>
              {unreadCount > 0 && (
                <span className="text-dr-muted text-sm">{unreadCount} UNREAD</span>
              )}
            </div>

            <div className="overflow-y-auto flex-1">
              {notifications.length === 0 ? (
                <div className="px-3 py-6 text-center text-dr-muted text-sm">
                  No notifications
                </div>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => handleNotificationClick(n)}
                    className={`w-full text-left px-3 py-2 border-b border-dr-border/50 hover:bg-dr-elevated transition-colors ${
                      !n.read ? 'bg-dr-elevated/50' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-sm flex-shrink-0 mt-0.5">
                        {levelIcon(n.level)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold truncate ${levelColor(n.level)}`}>
                            {n.title}
                          </span>
                          {!n.read && (
                            <span className="w-2 h-2 bg-dr-amber rounded-full flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-dr-muted truncate mt-0.5">
                          {n.detail}
                        </p>
                        <span className="text-xs text-dr-dim mt-0.5 block" suppressHydrationWarning>
                          {formatRelativeTime(n.createdAt)}
                        </span>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="px-3 py-2 border-t border-dr-border flex items-center justify-between gap-2">
              {notifications.length > 0 ? (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs text-dr-amber hover:text-dr-green transition-colors font-bold"
                >
                  [ MARK ALL READ ]
                </button>
              ) : (
                <span />
              )}
              <Link
                href="/notifications"
                onClick={() => setDropdownOpen(false)}
                className="text-xs text-dr-muted hover:text-dr-amber transition-colors font-bold"
              >
                [ ALL NOTIFICATIONS ]
              </Link>
            </div>
          </div>
        )}
      </div>

      <Link
        href="/logistics"
        className="flex items-center gap-1.5 text-xs whitespace-nowrap hover:opacity-80 transition-opacity"
      >
        <span className="text-dr-muted">LOGISTICS</span>
        <span className="text-sm text-dr-green">{'\u25CF'}</span>
      </Link>
    </header>
  );
}
