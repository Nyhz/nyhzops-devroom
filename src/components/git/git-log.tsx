'use client';

import { useState, useTransition } from 'react';
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

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const now = Date.now();
    const diff = now - date.getTime();
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
                  <div className="flex items-center gap-3">
                    <span className="text-dr-amber text-xs font-data shrink-0">
                      {shortHash}
                    </span>
                    <span className="text-dr-text text-xs font-tactical truncate flex-1">
                      {commit.message}
                    </span>
                    <span className="text-dr-dim text-xs font-tactical shrink-0">
                      {commit.author}
                    </span>
                    <span className="text-dr-dim text-xs font-tactical shrink-0 w-16 text-right">
                      {formatDate(commit.date)}
                    </span>
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
