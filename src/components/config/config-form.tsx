'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { updateBattlefield, regenerateBootstrap, readBootstrapFile } from '@/actions/battlefield';
import { TacInput, TacTextarea } from '@/components/ui/tac-input';
import { TacButton } from '@/components/ui/tac-button';
import {
  TacModal,
  TacModalContent,
  TacModalHeader,
  TacModalTitle,
} from '@/components/ui/modal';

interface ConfigFormProps {
  id: string;
  name: string;
  codename: string;
  description: string | null;
  initialBriefing: string | null;
  defaultBranch: string | null;
  devServerCommand: string | null;
  autoStartDevServer: number | null;
  repoPath: string;
  claudeMdPath: string | null;
  specMdPath: string | null;
}

export function ConfigForm({
  id,
  name: initialName,
  codename: initialCodename,
  description: initialDescription,
  initialBriefing: initialBriefingValue,
  defaultBranch: initialDefaultBranch,
  devServerCommand: initialDevServerCommand,
  autoStartDevServer: initialAutoStartDevServer,
  repoPath,
  claudeMdPath: initialClaudeMdPath,
  specMdPath: initialSpecMdPath,
}: ConfigFormProps) {
  const router = useRouter();

  // Editable fields
  const [name, setName] = useState(initialName);
  const [codename, setCodename] = useState(initialCodename);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [briefing, setBriefing] = useState(initialBriefingValue ?? '');
  const [defaultBranch, setDefaultBranch] = useState(initialDefaultBranch ?? 'main');
  const [devServerCommand, setDevServerCommand] = useState(initialDevServerCommand ?? 'npm run dev');
  const [autoStartDevServer, setAutoStartDevServer] = useState(!!initialAutoStartDevServer);

  // File paths (display)
  const [claudeMdPath] = useState(initialClaudeMdPath ?? '');
  const [specMdPath] = useState(initialSpecMdPath ?? '');

  // UI state
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTitle, setPreviewTitle] = useState('');
  const [previewContent, setPreviewContent] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  const handleSave = useCallback(async () => {
    setError('');
    setSaving(true);
    setSaved(false);

    try {
      await updateBattlefield(id, {
        name: name.trim(),
        codename: codename.trim(),
        description: description.trim() || undefined,
        initialBriefing: briefing.trim() || undefined,
        defaultBranch: defaultBranch.trim() || 'main',
        devServerCommand: devServerCommand.trim() || 'npm run dev',
        autoStartDevServer,
      });
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration.');
    } finally {
      setSaving(false);
    }
  }, [id, name, codename, description, briefing, defaultBranch, devServerCommand, autoStartDevServer, router]);

  const handleRebootstrap = useCallback(async () => {
    const confirmed = window.confirm(
      'This will re-generate CLAUDE.md and SPEC.md. Continue?',
    );
    if (!confirmed) return;

    setError('');

    try {
      await regenerateBootstrap(id, briefing.trim());
      router.push(`/projects/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to re-bootstrap.');
    }
  }, [id, briefing, router]);

  const handlePreview = useCallback(
    async (filename: 'CLAUDE.md' | 'SPEC.md') => {
      setPreviewTitle(filename);
      setPreviewContent('');
      setPreviewLoading(true);
      setPreviewOpen(true);

      try {
        const content = await readBootstrapFile(id, filename);
        setPreviewContent(content || '(empty)');
      } catch {
        setPreviewContent('Failed to load file content.');
      } finally {
        setPreviewLoading(false);
      }
    },
    [id],
  );

  return (
    <>
      <div className="bg-dr-surface border border-dr-border p-6 space-y-6">
        {/* Name */}
        <div>
          <label className="block text-dr-dim font-tactical text-xs uppercase tracking-wider mb-1">
            Name
          </label>
          <TacInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            disabled={saving}
          />
        </div>

        {/* Codename */}
        <div>
          <label className="block text-dr-dim font-tactical text-xs uppercase tracking-wider mb-1">
            Codename
          </label>
          <TacInput
            value={codename}
            onChange={(e) => setCodename(e.target.value)}
            placeholder="OPERATION THUNDER"
            disabled={saving}
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-dr-dim font-tactical text-xs uppercase tracking-wider mb-1">
            Description
          </label>
          <TacInput
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short project description"
            disabled={saving}
          />
        </div>

        {/* Initial Briefing */}
        <div>
          <label className="block text-dr-dim font-tactical text-xs uppercase tracking-wider mb-1">
            Initial Briefing
          </label>
          <TacTextarea
            value={briefing}
            onChange={(e) => setBriefing(e.target.value)}
            placeholder="Commander's project briefing for bootstrap..."
            rows={8}
            disabled={saving}
          />
        </div>

        {/* Separator */}
        <div className="border-t border-dr-border" />

        {/* Default Branch */}
        <div>
          <label className="block text-dr-dim font-tactical text-xs uppercase tracking-wider mb-1">
            Default Branch
          </label>
          <TacInput
            value={defaultBranch}
            onChange={(e) => setDefaultBranch(e.target.value)}
            placeholder="main"
            disabled={saving}
          />
        </div>

        {/* Dev Server Command */}
        <div>
          <label className="block text-dr-dim font-tactical text-xs uppercase tracking-wider mb-1">
            Dev Server Command
          </label>
          <TacInput
            value={devServerCommand}
            onChange={(e) => setDevServerCommand(e.target.value)}
            placeholder="npm run dev"
            disabled={saving}
          />
        </div>

        {/* Auto-start dev server */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setAutoStartDevServer(!autoStartDevServer)}
            className={`
              w-4 h-4 border flex items-center justify-center transition-colors
              ${autoStartDevServer
                ? 'border-dr-green bg-dr-green/20 text-dr-green'
                : 'border-dr-border bg-dr-bg text-transparent'
              }
            `}
            disabled={saving}
          >
            {autoStartDevServer && (
              <span className="text-xs leading-none">&#x2713;</span>
            )}
          </button>
          <label className="text-dr-dim font-tactical text-xs uppercase tracking-wider">
            Auto-start dev server on mission deploy
          </label>
        </div>

        {/* Separator */}
        <div className="border-t border-dr-border" />

        {/* Repo Path (read-only) */}
        <div>
          <label className="block text-dr-dim font-tactical text-xs uppercase tracking-wider mb-1">
            Repo Path
          </label>
          <div className="text-dr-dim font-data text-sm px-3 py-2 bg-dr-bg border border-dr-border opacity-60">
            {repoPath}
          </div>
        </div>

        {/* CLAUDE.md Path */}
        <div>
          <label className="block text-dr-dim font-tactical text-xs uppercase tracking-wider mb-1">
            CLAUDE.md Path
          </label>
          <div className="flex gap-2">
            <div className="flex-1 text-dr-muted font-data text-sm px-3 py-2 bg-dr-bg border border-dr-border">
              {claudeMdPath || '(not set)'}
            </div>
            {claudeMdPath && (
              <TacButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handlePreview('CLAUDE.md')}
              >
                Preview
              </TacButton>
            )}
          </div>
        </div>

        {/* SPEC.md Path */}
        <div>
          <label className="block text-dr-dim font-tactical text-xs uppercase tracking-wider mb-1">
            SPEC.md Path
          </label>
          <div className="flex gap-2">
            <div className="flex-1 text-dr-muted font-data text-sm px-3 py-2 bg-dr-bg border border-dr-border">
              {specMdPath || '(not set)'}
            </div>
            {specMdPath && (
              <TacButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handlePreview('SPEC.md')}
              >
                Preview
              </TacButton>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="text-dr-red font-tactical text-xs border border-dr-red/30 bg-dr-red/5 px-3 py-2">
            {error}
          </div>
        )}

        {/* Success */}
        {saved && (
          <div className="text-dr-green font-tactical text-xs border border-dr-green/30 bg-dr-green/5 px-3 py-2">
            Configuration saved, Commander.
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <TacButton
            type="button"
            variant="success"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </TacButton>
          <TacButton
            type="button"
            variant="primary"
            onClick={handleRebootstrap}
            disabled={saving}
          >
            Re-Bootstrap
          </TacButton>
        </div>
      </div>

      {/* Preview Modal */}
      <TacModal open={previewOpen} onOpenChange={setPreviewOpen}>
        <TacModalContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <TacModalHeader>
            <TacModalTitle>{previewTitle}</TacModalTitle>
          </TacModalHeader>
          <div className="flex-1 overflow-auto p-4">
            {previewLoading ? (
              <div className="text-dr-dim font-tactical text-sm animate-pulse">
                Loading...
              </div>
            ) : (
              <pre className="whitespace-pre-wrap font-data text-dr-text text-sm leading-relaxed">
                {previewContent}
              </pre>
            )}
          </div>
        </TacModalContent>
      </TacModal>
    </>
  );
}
