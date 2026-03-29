import { IntelBar } from "./intel-bar";
import { Sidebar } from "./sidebar";
import { StatusFooter } from "./status-footer";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="h-screen grid grid-rows-[auto_1fr_auto] bg-dr-bg">
      {/* Intel Bar — full width */}
      <IntelBar />

      {/* Middle row: sidebar + content */}
      <div className="grid grid-cols-1 md:grid-cols-[60px_1fr] lg:grid-cols-[300px_1fr] min-h-0">
        <Sidebar />
        <main className="overflow-y-auto">{children}</main>
      </div>

      {/* Status Footer — full width */}
      <StatusFooter />
    </div>
  );
}
