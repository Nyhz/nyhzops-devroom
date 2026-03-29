'use client';

import { useEffect, useTransition, useCallback } from 'react';
import { useState } from 'react';
import { TacButton } from '@/components/ui/tac-button';
import { TacInput } from '@/components/ui/tac-input';
import { TacTextareaWithImages } from '@/components/ui/tac-textarea-with-images';
import { createNote, updateNote, deleteNote } from '@/actions/intel';
import { formatRelativeTime, cn } from '@/lib/utils';
import type { IntelNoteWithMission } from '@/types';

interface NotePanelProps {
  battlefieldId: string;
  note: IntelNoteWithMission | null; // null = create mode
  onClose: () => void;
  onCreated: (note: IntelNoteWithMission) => void;
  onUpdated: (noteId: string, updates: Partial<IntelNoteWithMission>) => void;
  onDeleted: (noteId: string) => void;
  onPromoteMission: (note: IntelNoteWithMission) => void;
  onPromoteCampaign: (notes: IntelNoteWithMission[]) => void;
  className?: string;
}

export function NotePanel({
  battlefieldId,
  note,
  onClose,
  onCreated,
  onUpdated,
  onDeleted,
  onPromoteMission,
  onPromoteCampaign,
  className,
}: NotePanelProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isPending, startTransition] = useTransition();

  // Derive mode from note prop
  const isCreate = note === null;
  const isLinked = note !== null && note.missionId !== null;
  const isEdit = note !== null && note.missionId === null;

  // Reset form when note prop changes
  useEffect(() => {
    if (note === null) {
      setTitle('');
      setDescription('');
    } else {
      setTitle(note.title);
      setDescription(note.description ?? '');
    }
  }, [note]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleCreate = useCallback(() => {
    if (!title.trim()) return;
    startTransition(async () => {
      const created = await createNote(battlefieldId, title.trim(), description.trim() || undefined);
      const withMission: IntelNoteWithMission = {
        ...created,
        missionStatus: null,
        missionAssetCodename: null,
        missionCreatedAt: null,
      };
      onCreated(withMission);
      onClose();
    });
  }, [battlefieldId, title, description, onCreated, onClose]);

  const handleSave = useCallback(() => {
    if (!note || !title.trim()) return;
    startTransition(async () => {
      await updateNote(note.id, {
        title: title.trim(),
        description: description.trim() || undefined,
      });
      onUpdated(note.id, { title: title.trim(), description: description.trim() || undefined });
      onClose();
    });
  }, [note, title, description, onUpdated, onClose]);

  const handleDelete = useCallback(() => {
    if (!note) return;
    startTransition(async () => {
      await deleteNote(note.id);
      onDeleted(note.id);
      onClose();
    });
  }, [note, onDeleted, onClose]);

  const handlePromoteMission = useCallback(() => {
    if (!note) return;
    onPromoteMission(note);
    onClose();
  }, [note, onPromoteMission, onClose]);

  const handlePromoteCampaign = useCallback(() => {
    if (!note) return;
    onPromoteCampaign([note]);
    onClose();
  }, [note, onPromoteCampaign, onClose]);

  // Header label per mode
  const headerLabel = isCreate
    ? 'NEW NOTE'
    : isLinked
      ? 'LINKED MISSION'
      : 'EDIT NOTE';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={cn('fixed top-0 right-0 h-full w-[400px] bg-dr-bg border-l border-dr-border z-50 flex flex-col', className)}
        role="dialog"
        aria-modal="true"
        aria-label={headerLabel}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-dr-border flex-shrink-0">
          <span className="font-tactical text-dr-amber text-sm tracking-widest uppercase">
            {headerLabel}
          </span>
          <button
            onClick={onClose}
            className="text-dr-muted hover:text-dr-text font-tactical text-lg leading-none transition-colors"
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {isLinked && note ? (
            /* Read-only linked card view */
            <div className="space-y-3">
              <div>
                <label className="font-tactical text-dr-muted text-xs tracking-wider uppercase block mb-1">
                  Title
                </label>
                <p className="font-tactical text-dr-text text-sm border border-dr-border px-4 py-3 bg-dr-bg">
                  {note.title}
                </p>
              </div>

              {note.description && (
                <div>
                  <label className="font-tactical text-dr-muted text-xs tracking-wider uppercase block mb-1">
                    Description
                  </label>
                  <p className="font-tactical text-dr-text text-sm border border-dr-border px-4 py-3 bg-dr-bg whitespace-pre-wrap">
                    {note.description}
                  </p>
                </div>
              )}

              {note.missionStatus && (
                <div>
                  <label className="font-tactical text-dr-muted text-xs tracking-wider uppercase block mb-1">
                    Mission Status
                  </label>
                  <p className={cn(
                    'font-tactical text-xs tracking-widest uppercase',
                    note.missionStatus === 'accomplished' ? 'text-dr-green' :
                    note.missionStatus === 'compromised' ? 'text-dr-red' :
                    note.missionStatus === 'in_combat' || note.missionStatus === 'deploying' ? 'text-dr-amber' :
                    'text-dr-muted',
                  )}>
                    {note.missionStatus.replace('_', ' ')}
                  </p>
                </div>
              )}

              {note.missionAssetCodename && (
                <div>
                  <label className="font-tactical text-dr-muted text-xs tracking-wider uppercase block mb-1">
                    Asset
                  </label>
                  <p className="font-tactical text-dr-text text-sm">{note.missionAssetCodename}</p>
                </div>
              )}
            </div>
          ) : (
            /* Editable form — create or edit mode */
            <div className="space-y-4">
              <div>
                <label className="font-tactical text-dr-muted text-xs tracking-wider uppercase block mb-1">
                  Title
                </label>
                <TacInput
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Intel note title..."
                  disabled={isPending}
                  autoFocus
                />
              </div>

              <div>
                <label className="font-tactical text-dr-muted text-xs tracking-wider uppercase block mb-1">
                  Description
                </label>
                <TacTextareaWithImages
                  value={description}
                  onChange={setDescription}
                  placeholder="Details, context, or attachments..."
                  disabled={isPending}
                  className="min-h-[160px]"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-dr-border flex-shrink-0 space-y-3">
          {/* Created date */}
          {note && (
            <p className="font-tactical text-dr-muted text-xs tracking-wider">
              Created {formatRelativeTime(note.createdAt)}
            </p>
          )}

          {/* Action buttons */}
          {isCreate && (
            <div className="flex gap-2">
              <TacButton
                variant="primary"
                size="sm"
                onClick={handleCreate}
                disabled={isPending || !title.trim()}
                className="flex-1"
              >
                {isPending ? 'Creating...' : 'Create'}
              </TacButton>
              <TacButton
                variant="ghost"
                size="sm"
                onClick={onClose}
                disabled={isPending}
              >
                Cancel
              </TacButton>
            </div>
          )}

          {isEdit && (
            <>
              <div className="flex gap-2">
                <TacButton
                  variant="primary"
                  size="sm"
                  onClick={handleSave}
                  disabled={isPending || !title.trim()}
                  className="flex-1"
                >
                  {isPending ? 'Saving...' : 'Save'}
                </TacButton>
              </div>
              <div className="flex gap-2">
                <TacButton
                  variant="success"
                  size="sm"
                  onClick={handlePromoteMission}
                  disabled={isPending}
                  className="flex-1"
                >
                  Deploy Mission
                </TacButton>
                <TacButton
                  variant="success"
                  size="sm"
                  onClick={handlePromoteCampaign}
                  disabled={isPending}
                  className="flex-1"
                >
                  Launch Campaign
                </TacButton>
              </div>
              <div className="flex gap-2">
                <div className="flex-1" />
                <TacButton
                  variant="ghost"
                  size="sm"
                  onClick={handleDelete}
                  disabled={isPending}
                  className="text-dr-red/60 hover:text-dr-red border-transparent hover:border-transparent"
                >
                  {isPending ? 'Deleting...' : 'Delete'}
                </TacButton>
              </div>
            </>
          )}

          {isLinked && (
            <div className="flex gap-2">
              <TacButton
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="flex-1"
              >
                Close
              </TacButton>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
