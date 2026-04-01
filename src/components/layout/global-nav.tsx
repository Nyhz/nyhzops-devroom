'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const GLOBAL_LINKS = [
  { href: '/', icon: '◉', label: 'HQ', exact: true },
  { href: '/general', icon: '◇', label: 'GENERAL', exact: false },
] as const;

const BOTTOM_LINKS = [
  { href: '/overseer-log', icon: '⚓', label: "OVERSEER'S LOG" },
  { href: '/assets', icon: '◎', label: 'ASSETS' },
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
        'flex items-center gap-3 px-3 py-2.5 text-sm transition-colors min-h-[44px]',
        active
          ? 'bg-dr-elevated text-dr-amber'
          : 'text-dr-muted hover:text-dr-text hover:bg-dr-elevated',
      )}
    >
      <span className={cn('w-6 text-center text-base', active && 'text-dr-amber')}>
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
