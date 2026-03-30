'use client';

import { useState, useEffect, useRef, useTransition } from 'react';
import { TacButton } from '@/components/ui/tac-button';
import { GitDiff } from '@/components/git/git-diff';
import { TacCard } from '@/components/ui/tac-card';
import { cn } from '@/lib/utils';
import { getGitLog } from '@/actions/git';
import type { CommitEntry } from '@/types';

interface GitLogProps {
  battlefieldId: string;
  initialCommits: CommitEntry[];
  className?: string;
}

export function GitLog({ battlefieldId, initialCommits, className }: GitLogProps) {
  const [commits, setCommits] = useState<CommitEntry[]>(initialCommits);
  const [isPending, startTransition] = useTransition();
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(initialCommits.length >= 50);

  function loadMore() {
    startTransition(async () => {
      const result = await getGitLog(battlefieldId, 50, commits.length);
      if (result.commits.length < 50) {
        setHasMore(false);
      }
      setCommits((prev) => [...prev, ...result.commits]);
    });
  }

  const nowRef = useRef(Date.now());

  useEffect(() => {
    nowRef.current = Date.now();
  }, []);

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const diff = nowRef.current - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return `${seconds}s ago`;
  }

  return (
    <div className={cn('space-y-0', className)}>
      {commits.length === 0 ? (
        <div className="text-dr-dim text-xs font-tactical p-4">No commits found</div>
      ) : (
        <TacCard className="p-0">
          {commits.map((commit) => {
            const shortHash = commit.hash.slice(0, 7);
            const isExpanded = expandedHash === commit.hash;

            return (
              <div key={commit.hash} className="border-b border-dr-border/50 last:border-b-0">
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 hover:bg-dr-elevated/50 transition-colors"
                  onClick={() => setExpandedHash(isExpanded ? null : commit.hash)}
                >
                  <div className="flex flex-col items-start gap-1 md:flex-row md:items-center md:gap-3">
                    <span className="text-dr-text text-xs font-tactical truncate max-w-full md:order-2 md:flex-1">
                      {commit.message}
                    </span>
                    <div className="flex items-center gap-2 text-dr-dim text-xs font-tactical md:contents">
                      <span className="text-dr-amber font-data shrink-0 md:order-1">
                        {shortHash}
                      </span>
                      <span className="shrink-0 md:order-3">
                        {commit.author}
                      </span>
                      <span className="shrink-0 md:w-16 md:text-right md:order-4" suppressHydrationWarning>
                        {formatDate(commit.date)}
                      </span>
                    </div>
                  </div>
                  {commit.refs && (
                    <div className="mt-1">
                      <span className="text-dr-green text-xs font-tactical">
                        {commit.refs}
                      </span>
                    </div>
                  )}
                </button>
                {isExpanded && (
                  <div className="px-3 pb-3">
                    <GitDiff
                      diff={`Commit: ${commit.hash}\nAuthor: ${commit.author}\nDate: ${commit.date}\n\n${commit.message}`}
                      filePath={`commit ${shortHash}`}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </TacCard>
      )}

      {hasMore && (
        <div className="pt-3">
          <TacButton
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={loadMore}
            className="w-full"
          >
            {isPending ? 'Loading...' : 'Load More'}
          </TacButton>
        </div>
      )}
    </div>
  );
}
