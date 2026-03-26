"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TacButton } from "@/components/ui/tac-button";
import { TacTextarea } from "@/components/ui/tac-input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Markdown } from "@/components/ui/markdown";
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
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to save file";
      alert(message);
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
      router.push(`/projects/${battlefieldId}`);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to approve bootstrap";
      alert(message);
      setIsPending(false);
    }
  }

  async function handleRegenerate() {
    setIsPending(true);
    try {
      await regenerateBootstrap(battlefieldId, regenerateBriefing);
      router.refresh();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to regenerate bootstrap";
      alert(message);
    } finally {
      setIsPending(false);
    }
  }

  async function handleAbandon() {
    if (
      !confirm(
        "This will delete the battlefield and all associated data.",
      )
    ) {
      return;
    }
    setIsPending(true);
    try {
      await abandonBootstrap(battlefieldId);
      router.push("/projects");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to abandon bootstrap";
      alert(message);
      setIsPending(false);
    }
  }

  function renderDocumentCard(
    filename: "CLAUDE.md" | "SPEC.md",
    content: string,
  ) {
    const isEditing = editingFile === filename;

    return (
      <div
        className={`bg-dr-surface border border-dr-border ${isEditing ? "shadow-glow-amber" : ""}`}
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
      </div>
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
        <div className="bg-dr-surface border border-dr-border">
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
        </div>
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
    </div>
  );
}
