'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface BootstrapInProgressProps {
  codename: string;
  claudeMdExists: boolean;
  specMdExists: boolean;
}

function buildTargetCopy(claudeMdExists: boolean, specMdExists: boolean): string {
  if (!claudeMdExists && !specMdExists) return 'CLAUDE.md and SPEC.md';
  if (!claudeMdExists) return 'CLAUDE.md (SPEC.md supplied by Commander)';
  if (!specMdExists) return 'SPEC.md (CLAUDE.md supplied by Commander)';
  return 'final checks';
}

export function BootstrapInProgress({
  codename,
  claudeMdExists,
  specMdExists,
}: BootstrapInProgressProps) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [router]);

  const target = buildTargetCopy(claudeMdExists, specMdExists);

  return (
    <div className="flex items-center justify-center h-full p-4 md:p-6">
      <div className="text-center">
        <div className="text-dr-amber text-xl font-tactical tracking-wider mb-2">
          {codename} — BOOTSTRAP IN PROGRESS
        </div>
        <div className="text-dr-dim text-sm animate-pulse">
          INTEL is generating {target} — this may take a few minutes.
        </div>
      </div>
    </div>
  );
}
