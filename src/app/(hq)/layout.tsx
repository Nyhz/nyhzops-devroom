import { AppShell } from '@/components/layout/app-shell';

export default function HQLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
