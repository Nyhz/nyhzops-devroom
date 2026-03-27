"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useNotifications } from "@/hooks/use-notifications";
import { formatRelativeTime } from "@/lib/utils";
import type { Notification } from "@/types";

const INTEL_QUOTES = [
  "The supreme art of war is to subdue the enemy without fighting. — Sun Tzu",
  "No plan survives first contact with the enemy. — Helmuth von Moltke",
  "In preparing for battle I have always found that plans are useless, but planning is indispensable. — Eisenhower",
  "The more you sweat in training, the less you bleed in combat. — Richard Marcinko",
  "Speed is the essence of war. — Sun Tzu",
  "Who dares wins. — SAS motto",
  "The only easy day was yesterday. — Navy SEALs",
  "Brave men rejoice in adversity, just as brave soldiers triumph in war. — Seneca",
  "Strategy without tactics is the slowest route to victory. Tactics without strategy is the noise before defeat. — Sun Tzu",
  "Fortune favors the bold. — Virgil",
  "Let your plans be dark and impenetrable as night, and when you move, fall like a thunderbolt. — Sun Tzu",
  "Amateurs talk strategy. Professionals talk logistics. — Gen. Omar Bradley",
  "A good plan violently executed now is better than a perfect plan executed next week. — Patton",
  "Victory belongs to the most persevering. — Napoleon",
  "We sleep safely at night because rough men stand ready to visit violence on those who would harm us. — attributed to Orwell",
];


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
      return `/projects/${n.battlefieldId}/missions/${n.entityId}`;
    case 'campaign':
      return `/projects/${n.battlefieldId}/campaigns/${n.entityId}`;
    case 'phase':
      return null; // phases don't have their own page
    default:
      return null;
  }
}

export function IntelBar() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const { notifications, unreadCount, markAsRead, markAllRead } = useNotifications();

  useEffect(() => {
    // Pick a random starting index on mount
    setIndex(Math.floor(Math.random() * INTEL_QUOTES.length));
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      // Fade out
      setVisible(false);
      // After fade, switch quote and fade in
      setTimeout(() => {
        setIndex((prev) => (prev + 1) % INTEL_QUOTES.length);
        setVisible(true);
      }, 400);
    }, 60_000);

    return () => clearInterval(interval);
  }, []);

  // Rate limit info is updated via Socket.IO when missions complete
  // No polling needed

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

  // No rate limit label computation needed — just a link to LOGISTICS

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
      <span className="text-dr-amber font-bold text-sm whitespace-nowrap">
        INTEL //
      </span>
      <span
        className="text-dr-dim text-sm truncate transition-opacity duration-300 flex-1"
        style={{ opacity: visible ? 1 : 0 }}
      >
        {INTEL_QUOTES[index]}
      </span>

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
          <div className="absolute right-0 top-full mt-1 w-[380px] bg-dr-surface border border-dr-border shadow-lg z-50 max-h-[420px] flex flex-col">
            <div className="px-3 py-2 border-b border-dr-border flex items-center justify-between">
              <span className="text-dr-amber text-xs font-bold">NOTIFICATIONS</span>
              {unreadCount > 0 && (
                <span className="text-dr-dim text-xs">{unreadCount} UNREAD</span>
              )}
            </div>

            <div className="overflow-y-auto flex-1">
              {notifications.length === 0 ? (
                <div className="px-3 py-6 text-center text-dr-dim text-xs">
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
                            <span className="w-1.5 h-1.5 bg-dr-amber rounded-full flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-dr-muted truncate mt-0.5">
                          {n.detail}
                        </p>
                        <span className="text-[10px] text-dr-dim mt-0.5 block">
                          {formatRelativeTime(n.createdAt)}
                        </span>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            {notifications.length > 0 && (
              <div className="px-3 py-2 border-t border-dr-border">
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs text-dr-amber hover:text-dr-green transition-colors font-bold w-full text-center"
                >
                  [ MARK ALL READ ]
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <Link
        href="/logistics"
        className="flex items-center gap-1.5 text-xs whitespace-nowrap hover:opacity-80 transition-opacity"
      >
        <span className="text-dr-dim">LOGISTICS</span>
        <span className="text-sm text-dr-green">{'\u25CF'}</span>
      </Link>
    </header>
  );
}
