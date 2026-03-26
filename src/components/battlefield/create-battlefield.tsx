'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { TacInput, TacTextarea } from '@/components/ui/tac-input';
import { TacButton } from '@/components/ui/tac-button';
import { createBattlefield } from '@/actions/battlefield';
import { toKebabCase } from '@/lib/utils';

interface CreateBattlefieldProps {
  devBasePath: string;
}

export function CreateBattlefield({ devBasePath }: CreateBattlefieldProps) {
  const router = useRouter();

  const [mode, setMode] = useState<'new' | 'link'>('new');
  const [name, setName] = useState('');
  const [codename, setCodename] = useState('');
  const [codenameManuallyEdited, setCodenameManuallyEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [initialBriefing, setInitialBriefing] = useState('');
  const [scaffoldCommand, setScaffoldCommand] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [repoPath, setRepoPath] = useState('');
  const [skipBootstrap, setSkipBootstrap] = useState(false);
  const [claudeMdPathInput, setClaudeMdPathInput] = useState('');
  const [specMdPathInput, setSpecMdPathInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleNameChange = useCallback(
    (value: string) => {
      setName(value);
      if (!codenameManuallyEdited) {
        setCodename(value ? `OPERATION ${value.toUpperCase()}` : '');
      }
    },
    [codenameManuallyEdited],
  );

  const handleCodenameChange = useCallback((value: string) => {
    setCodename(value);
    setCodenameManuallyEdited(true);
  }, []);

  const toggleMode = useCallback(() => {
    setMode((prev) => (prev === 'new' ? 'link' : 'new'));
    setError('');
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError('');

      if (!name.trim()) {
        setError('Name is required.');
        return;
      }

      if (mode === 'link' && !repoPath.trim()) {
        setError('Repo path is required when linking an existing repository.');
        return;
      }

      setSubmitting(true);

      try {
        const battlefield = await createBattlefield({
          name: name.trim(),
          codename: codename.trim() || `OPERATION ${name.trim().toUpperCase()}`,
          description: description.trim() || undefined,
          initialBriefing: skipBootstrap ? undefined : (initialBriefing.trim() || undefined),
          scaffoldCommand: mode === 'new' && scaffoldCommand.trim() ? scaffoldCommand.trim() : undefined,
          defaultBranch: mode === 'new' ? defaultBranch.trim() || 'main' : undefined,
          repoPath: mode === 'link' ? repoPath.trim() : undefined,
          skipBootstrap,
          claudeMdPath: skipBootstrap ? claudeMdPathInput.trim() || undefined : undefined,
          specMdPath: skipBootstrap ? specMdPathInput.trim() || undefined : undefined,
        });

        // Fire-and-forget scaffold if applicable
        if (mode === 'new' && scaffoldCommand.trim()) {
          fetch(`/api/battlefields/${battlefield.id}/scaffold`, {
            method: 'POST',
          }).catch(() => {
            // Intentionally ignored — scaffold runs in background
          });
        }

        router.push(`/projects/${battlefield.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create battlefield.');
        setSubmitting(false);
      }
    },
    [name, codename, description, initialBriefing, scaffoldCommand, defaultBranch, repoPath, mode, router, skipBootstrap, claudeMdPathInput, specMdPathInput],
  );

  const computedRepoPath = name.trim()
    ? `${devBasePath}/${toKebabCase(name.trim())}`
    : `${devBasePath}/...`;

  return (
    <form onSubmit={handleSubmit} className="bg-dr-surface border border-dr-border p-6 space-y-5">
      {/* Mode toggle */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={toggleMode}
          className="text-dr-amber font-tactical text-xs tracking-wider hover:text-dr-green transition-colors"
        >
          [{mode === 'new' ? 'Link existing repo' : 'Create new project'}]
        </button>
      </div>

      {/* Repo path (link mode only) */}
      {mode === 'link' && (
        <div>
          <label className="block text-dr-amber font-tactical text-xs tracking-wider mb-1">
            REPO PATH
          </label>
          <TacInput
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            placeholder="/absolute/path/to/existing/repo"
            disabled={submitting}
          />
        </div>
      )}

      {/* Name */}
      <div>
        <label className="block text-dr-amber font-tactical text-xs tracking-wider mb-1">
          NAME
        </label>
        <TacInput
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="Project name"
          disabled={submitting}
        />
        {mode === 'new' && (
          <div className="text-dr-dim font-tactical text-xs mt-1">
            {computedRepoPath}
          </div>
        )}
      </div>

      {/* Codename */}
      <div>
        <label className="block text-dr-amber font-tactical text-xs tracking-wider mb-1">
          CODENAME
        </label>
        <TacInput
          value={codename}
          onChange={(e) => handleCodenameChange(e.target.value)}
          placeholder="OPERATION THUNDER"
          disabled={submitting}
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-dr-amber font-tactical text-xs tracking-wider mb-1">
          DESCRIPTION
        </label>
        <TacInput
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short project description"
          disabled={submitting}
        />
      </div>

      {/* Initial Briefing / Skip Bootstrap */}
      <div>
        {!skipBootstrap && (
          <>
            <label className="block text-dr-amber font-tactical text-xs tracking-wider mb-1">
              INITIAL BRIEFING
            </label>
            <TacTextarea
              value={initialBriefing}
              onChange={(e) => setInitialBriefing(e.target.value)}
              placeholder="Commander's project briefing for bootstrap..."
              rows={6}
              disabled={submitting}
            />
          </>
        )}

        {skipBootstrap && (
          <div className="space-y-3">
            <div>
              <label className="block text-dr-amber font-tactical text-xs tracking-wider mb-1">
                CLAUDE.MD PATH
              </label>
              <TacInput
                value={claudeMdPathInput}
                onChange={(e) => setClaudeMdPathInput(e.target.value)}
                placeholder="Absolute path to CLAUDE.md"
                disabled={submitting}
              />
            </div>
            <div>
              <label className="block text-dr-amber font-tactical text-xs tracking-wider mb-1">
                SPEC.MD PATH
              </label>
              <TacInput
                value={specMdPathInput}
                onChange={(e) => setSpecMdPathInput(e.target.value)}
                placeholder="Absolute path to SPEC.md (optional)"
                disabled={submitting}
              />
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setSkipBootstrap(!skipBootstrap)}
          className="text-dr-dim text-xs hover:text-dr-muted underline mt-2"
        >
          {skipBootstrap ? '← Generate docs automatically' : 'Skip bootstrap — I\'ll provide my own CLAUDE.md'}
        </button>
      </div>

      {/* New project fields */}
      {mode === 'new' && (
        <>
          <div>
            <label className="block text-dr-amber font-tactical text-xs tracking-wider mb-1">
              SCAFFOLD COMMAND
            </label>
            <TacInput
              value={scaffoldCommand}
              onChange={(e) => setScaffoldCommand(e.target.value)}
              placeholder="e.g. npx create-next-app . --typescript"
              disabled={submitting}
            />
            <div className="text-dr-dim font-tactical text-xs mt-1">
              Optional. Runs after repo initialization.
            </div>
          </div>

          <div>
            <label className="block text-dr-amber font-tactical text-xs tracking-wider mb-1">
              DEFAULT BRANCH
            </label>
            <TacInput
              value={defaultBranch}
              onChange={(e) => setDefaultBranch(e.target.value)}
              placeholder="main"
              disabled={submitting}
            />
          </div>
        </>
      )}

      {/* Error */}
      {error && (
        <div className="text-dr-red font-tactical text-xs border border-dr-red/30 bg-dr-red/5 px-3 py-2">
          {error}
        </div>
      )}

      {/* Submit */}
      <div className="flex justify-end pt-2">
        <TacButton type="submit" disabled={submitting}>
          {submitting ? 'DEPLOYING...' : 'CREATE BATTLEFIELD'}
        </TacButton>
      </div>
    </form>
  );
}
