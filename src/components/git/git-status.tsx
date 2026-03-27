'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { TacButton } from '@/components/ui/tac-button';
import { TacInput } from '@/components/ui/tac-input';
import { GitDiff } from '@/components/git/git-diff';
import { cn } from '@/lib/utils';
import {
  stageFile,
  unstageFile,
  stageAll,
  unstageAll,
  commitChanges,
  getFileDiff,
} from '@/actions/git';
import type { GitStatusResult } from '@/types';

interface GitStatusProps {
  battlefieldId: string;
  initialStatus: GitStatusResult;
  className?: string;
}

export function GitStatus({ battlefieldId, initialStatus, className }: GitStatusProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [commitMessage, setCommitMessage] = useState('');
  const [expandedDiff, setExpandedDiff] = useState<{ path: string; diff: string } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const { staged, modified, untracked } = initialStatus;
  const hasStaged = staged.length > 0;
  const hasChanges = modified.length > 0 || untracked.length > 0;

  function runAction(action: () => Promise<void>) {
    startTransition(async () => {
      await action();
      router.refresh();
    });
  }

  async function handleDiff(filePath: string) {
    if (expandedDiff?.path === filePath) {
      setExpandedDiff(null);
      return;
    }
    setDiffLoading(true);
    try {
      const diff = await getFileDiff(battlefieldId, filePath);
      setExpandedDiff({ path: filePath, diff });
    } finally {
      setDiffLoading(false);
    }
  }

  function handleCommit() {
    if (!commitMessage.trim() || !hasStaged) return;
    startTransition(async () => {
      try {
        await commitChanges(battlefieldId, commitMessage.trim());
        setCommitMessage('');
        toast.success('Changes committed');
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Commit failed');
      }
    });
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Bulk actions */}
      <div className="flex items-center gap-2">
        <TacButton
          size="sm"
          variant="success"
          disabled={isPending || !hasChanges}
          onClick={() => runAction(() => stageAll(battlefieldId))}
        >
          Stage All
        </TacButton>
        <TacButton
          size="sm"
          variant="ghost"
          disabled={isPending || !hasStaged}
          onClick={() => runAction(() => unstageAll(battlefieldId))}
        >
          Unstage All
        </TacButton>
      </div>

      {/* Staged files */}
      <FileSection
        title="STAGED"
        count={staged.length}
        accentClass="text-dr-green"
        borderClass="border-l-dr-green"
      >
        {staged.length === 0 ? (
          <div className="text-dr-dim text-xs font-tactical px-3 py-2">No staged files</div>
        ) : (
          staged.map((file) => (
            <FileRow key={file.path} path={file.path} status={file.status} accentClass="text-dr-green">
              <TacButton
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={() => runAction(() => unstageFile(battlefieldId, file.path))}
              >
                Unstage
              </TacButton>
            </FileRow>
          ))
        )}
      </FileSection>

      {/* Modified files */}
      <FileSection
        title="MODIFIED"
        count={modified.length}
        accentClass="text-dr-amber"
        borderClass="border-l-dr-amber"
      >
        {modified.length === 0 ? (
          <div className="text-dr-dim text-xs font-tactical px-3 py-2">No modified files</div>
        ) : (
          modified.map((file) => (
            <div key={file.path}>
              <FileRow path={file.path} status={file.status} accentClass="text-dr-amber">
                <TacButton
                  size="sm"
                  variant="success"
                  disabled={isPending}
                  onClick={() => runAction(() => stageFile(battlefieldId, file.path))}
                >
                  Stage
                </TacButton>
                <TacButton
                  size="sm"
                  variant="ghost"
                  disabled={diffLoading}
                  onClick={() => handleDiff(file.path)}
                >
                  {expandedDiff?.path === file.path ? 'Hide' : 'Diff'}
                </TacButton>
              </FileRow>
              {expandedDiff?.path === file.path && (
                <GitDiff diff={expandedDiff.diff} filePath={file.path} className="mx-3 mb-2" />
              )}
            </div>
          ))
        )}
      </FileSection>

      {/* Untracked files */}
      <FileSection
        title="UNTRACKED"
        count={untracked.length}
        accentClass="text-dr-dim"
        borderClass="border-l-dr-dim"
      >
        {untracked.length === 0 ? (
          <div className="text-dr-dim text-xs font-tactical px-3 py-2">No untracked files</div>
        ) : (
          untracked.map((file) => (
            <FileRow key={file.path} path={file.path} status={file.status} accentClass="text-dr-dim">
              <TacButton
                size="sm"
                variant="success"
                disabled={isPending}
                onClick={() => runAction(() => stageFile(battlefieldId, file.path))}
              >
                Stage
              </TacButton>
            </FileRow>
          ))
        )}
      </FileSection>

      {/* Commit form */}
      <div className="bg-dr-surface border border-dr-border p-4 space-y-3">
        <div className="text-dr-amber text-xs font-tactical tracking-wider">COMMIT</div>
        <TacInput
          placeholder="Commit message..."
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleCommit();
            }
          }}
          disabled={isPending}
        />
        <TacButton
          variant="success"
          size="sm"
          disabled={isPending || !hasStaged || !commitMessage.trim()}
          onClick={handleCommit}
        >
          Commit
        </TacButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FileSection({
  title,
  count,
  accentClass,
  borderClass,
  children,
}: {
  title: string;
  count: number;
  accentClass: string;
  borderClass: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('bg-dr-surface border border-dr-border border-l-2', borderClass)}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-dr-border">
        <span className={cn('text-xs font-tactical tracking-wider', accentClass)}>
          {title}
        </span>
        <span className="text-dr-dim text-xs font-tactical">{count}</span>
      </div>
      <div>{children}</div>
    </div>
  );
}

function FileRow({
  path,
  status,
  accentClass,
  children,
}: {
  path: string;
  status: string;
  accentClass: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 border-b border-dr-border/50 last:border-b-0 hover:bg-dr-elevated/50">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className={cn('text-xs font-tactical uppercase w-20 shrink-0', accentClass)}>
          {status}
        </span>
        <span className="text-dr-text text-xs font-data truncate">{path}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0 ml-2">{children}</div>
    </div>
  );
}
