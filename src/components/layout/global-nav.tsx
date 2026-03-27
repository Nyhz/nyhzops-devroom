'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const GLOBAL_LINKS = [
  { href: '/', icon: '⌘', label: 'WAR ROOM', exact: true },
  { href: '/battlefields', icon: '◉', label: 'HQ', exact: false },
] as const;

const BOTTOM_LINKS = [
  { href: '/captain-log', icon: '⚓', label: "CAPTAIN'S LOG" },
  { href: '/logistics', icon: '◈', label: 'LOGISTICS' },
] as const;

function NavLink({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 text-sm transition-colors',
        active
          ? 'bg-dr-elevated text-dr-amber'
          : 'text-dr-muted hover:text-dr-text hover:bg-dr-elevated',
      )}
    >
      <span className={cn('w-5 text-center text-xs', active && 'text-dr-amber')}>
        {icon}
      </span>
      <span className="flex-1">{label}</span>
    </Link>
  );
}

export function GlobalNavTop() {
  const pathname = usePathname();

  return (
    <div className="px-3 py-2 space-y-0.5">
      {GLOBAL_LINKS.map((link) => {
        const active = link.exact
          ? pathname === link.href
          : pathname.startsWith(link.href);
        return (
          <NavLink
            key={link.href}
            href={link.href}
            icon={link.icon}
            label={link.label}
            active={active}
          />
        );
      })}
    </div>
  );
}

export function GlobalNavBottom() {
  const pathname = usePathname();

  return (
    <div className="px-3 mb-1 space-y-0.5">
      {BOTTOM_LINKS.map((link) => {
        const active = pathname.startsWith(link.href);
        return (
          <NavLink
            key={link.href}
            href={link.href}
            icon={link.icon}
            label={link.label}
            active={active}
          />
        );
      })}
    </div>
  );
}
