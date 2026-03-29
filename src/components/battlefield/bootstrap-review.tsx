"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { TacButton } from "@/components/ui/tac-button";
import { TacCard } from "@/components/ui/tac-card";
import { TacTextarea } from "@/components/ui/tac-input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Markdown } from "@/components/ui/markdown";
import { useConfirm } from "@/hooks/use-confirm";
import {
  approveBootstrap,
  regenerateBootstrap,
  abandonBootstrap,
  writeBootstrapFile,
} from "@/actions/battlefield";

interface BootstrapReviewProps {
  battlefieldId: string;
  codename: string;
  initialBriefing: string;
  initialClaudeMd: string;
  initialSpecMd: string;
}

export function BootstrapReview({
  battlefieldId,
  codename,
  initialBriefing,
  initialClaudeMd,
  initialSpecMd,
}: BootstrapReviewProps) {
  const router = useRouter();
  const [confirm, ConfirmDialog] = useConfirm();

  const [claudeMd, setClaudeMd] = useState(initialClaudeMd);
  const [specMd, setSpecMd] = useState(initialSpecMd);
  const [editingFile, setEditingFile] = useState<
    "CLAUDE.md" | "SPEC.md" | null
  >(null);
  const [editContent, setEditContent] = useState("");
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [regenerateBriefing, setRegenerateBriefing] =
    useState(initialBriefing);
  const [isPending, setIsPending] = useState(false);

  function handleEdit(file: "CLAUDE.md" | "SPEC.md") {
    setEditingFile(file);
    setEditContent(file === "CLAUDE.md" ? claudeMd : specMd);
  }

  async function handleSaveEdit() {
    if (!editingFile) return;
    setIsPending(true);
    try {
      await writeBootstrapFile(battlefieldId, editingFile, editContent);
      if (editingFile === "CLAUDE.md") {
        setClaudeMd(editContent);
      } else {
        setSpecMd(editContent);
      }
      setEditingFile(null);
      toast.success(`${editingFile} saved`);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to save file";
      toast.error(message);
    } finally {
      setIsPending(false);
    }
  }

  function handleCancelEdit() {
    setEditingFile(null);
    setEditContent("");
  }

  async function handleApprove() {
    setIsPending(true);
    try {
      await approveBootstrap(battlefieldId);
      toast.success('Bootstrap approved — Battlefield active');
      router.push(`/battlefields/${battlefieldId}`);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to approve bootstrap";
      toast.error(message);
      setIsPending(false);
    }
  }

  async function handleRegenerate() {
    setIsPending(true);
    toast('Regenerating bootstrap...');
    try {
      await regenerateBootstrap(battlefieldId, regenerateBriefing);
      router.refresh();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to regenerate bootstrap";
      toast.error(message);
    } finally {
      setIsPending(false);
    }
  }

  async function handleAbandon() {
    const result = await confirm({
      title: 'ABANDON BATTLEFIELD',
      description: 'This action is permanent and cannot be undone.',
      body: <p>This will delete the battlefield and all associated data.</p>,
      actions: [{ label: 'ABANDON', variant: 'danger' }],
    });
    if (result !== 0) return;
    setIsPending(true);
    try {
      await abandonBootstrap(battlefieldId);
      toast.success('Bootstrap abandoned');
      router.push("/");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to abandon bootstrap";
      toast.error(message);
      setIsPending(false);
    }
  }

  function renderDocumentCard(
    filename: "CLAUDE.md" | "SPEC.md",
    content: string,
  ) {
    const isEditing = editingFile === filename;

    return (
      <TacCard
        className={`p-0 ${isEditing ? "shadow-glow-amber" : ""}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between bg-dr-elevated px-4 py-2">
          <span className="font-tactical tracking-wider uppercase text-dr-amber text-sm">
            {isEditing ? `◆ EDITING — ${filename}` : filename}
          </span>
          {!isEditing && (
            <TacButton
              variant="ghost"
              size="sm"
              onClick={() => handleEdit(filename)}
              disabled={isPending || editingFile !== null}
            >
              EDIT
            </TacButton>
          )}
        </div>

        {/* Content */}
        {isEditing ? (
          <div className="p-4">
            <TacTextarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full min-h-96 font-data bg-dr-bg text-dr-text"
              disabled={isPending}
            />
            <div className="flex gap-3 mt-3">
              <TacButton
                variant="success"
                size="sm"
                onClick={handleSaveEdit}
                disabled={isPending}
              >
                SAVE
              </TacButton>
              <TacButton
                variant="ghost"
                size="sm"
                onClick={handleCancelEdit}
                disabled={isPending}
              >
                CANCEL
              </TacButton>
            </div>
          </div>
        ) : (
          <ScrollArea className="max-h-96">
            <div className="font-data p-4 text-sm">
              <Markdown content={content} />
            </div>
          </ScrollArea>
        )}
      </TacCard>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-tactical tracking-wider uppercase text-dr-amber text-2xl">
          {codename} — BOOTSTRAP COMPLETE
        </h1>
        <p className="font-tactical tracking-wider uppercase text-dr-dim text-sm mt-1">
          Status: INITIALIZING — Awaiting Commander review
        </p>
      </div>

      {/* Document cards */}
      <div className="space-y-4">
        {renderDocumentCard("CLAUDE.md", claudeMd)}
        {renderDocumentCard("SPEC.md", specMd)}
      </div>

      {/* Regenerate section */}
      {showRegenerate && (
        <TacCard className="p-0">
          <div className="bg-dr-elevated px-4 py-2">
            <span className="font-tactical tracking-wider uppercase text-dr-amber text-sm">
              REGENERATE — Edit Briefing
            </span>
          </div>
          <div className="p-4">
            <TacTextarea
              value={regenerateBriefing}
              onChange={(e) => setRegenerateBriefing(e.target.value)}
              className="w-full min-h-48 font-data"
              disabled={isPending}
            />
            <div className="flex gap-3 mt-3">
              <TacButton
                variant="primary"
                onClick={handleRegenerate}
                disabled={isPending}
              >
                CONFIRM REGENERATE
              </TacButton>
              <TacButton
                variant="ghost"
                onClick={() => setShowRegenerate(false)}
                disabled={isPending}
              >
                CANCEL
              </TacButton>
            </div>
          </div>
        </TacCard>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        <TacButton
          variant="success"
          onClick={handleApprove}
          disabled={isPending || editingFile !== null}
        >
          APPROVE & DEPLOY
        </TacButton>
        <TacButton
          variant="primary"
          onClick={() => setShowRegenerate(!showRegenerate)}
          disabled={isPending || editingFile !== null}
        >
          REGENERATE
        </TacButton>
        <TacButton
          variant="danger"
          onClick={handleAbandon}
          disabled={isPending || editingFile !== null}
        >
          ABANDON
        </TacButton>
      </div>

      <ConfirmDialog />
    </div>
  );
}
