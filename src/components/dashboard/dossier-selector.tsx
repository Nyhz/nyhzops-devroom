'use client';

import { useState, useEffect, useTransition } from 'react';
import { TacButton } from '@/components/ui/tac-button';
import { TacInput } from '@/components/ui/tac-input';
import {
  TacModal,
  TacModalContent,
  TacModalFooter,
  TacModalHeader,
  TacModalTitle,
  TacModalDescription,
} from '@/components/ui/modal';
import { listDossiers, resolveDossier } from '@/actions/dossier';
import type { Dossier, DossierVariable } from '@/types';

interface DossierSelectorProps {
  onApply: (briefing: string, assetCodename: string | null) => void;
  className?: string;
}

type ModalView = 'list' | 'form';

export function DossierSelector({ onApply, className }: DossierSelectorProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ModalView>('list');
  const [allDossiers, setAllDossiers] = useState<Dossier[]>([]);
  const [selectedDossier, setSelectedDossier] = useState<Dossier | null>(null);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (open) {
      startTransition(async () => {
        const result = await listDossiers();
        setAllDossiers(result);
      });
    }
  }, [open]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setView('list');
      setSelectedDossier(null);
      setVariableValues({});
    }
  };

  const handleSelect = (dossier: Dossier) => {
    setSelectedDossier(dossier);
    const vars = parseVariables(dossier.variables);
    const initial: Record<string, string> = {};
    for (const v of vars) {
      initial[v.key] = '';
    }
    setVariableValues(initial);
    setView('form');
  };

  const handleBack = () => {
    setView('list');
    setSelectedDossier(null);
    setVariableValues({});
  };

  const handleApply = () => {
    if (!selectedDossier) return;
    startTransition(async () => {
      const { briefing, assetCodename } = await resolveDossier(
        selectedDossier.id,
        variableValues,
      );
      onApply(briefing, assetCodename);
      handleOpenChange(false);
    });
  };

  const variables = selectedDossier ? parseVariables(selectedDossier.variables) : [];

  return (
    <TacModal open={open} onOpenChange={handleOpenChange}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`text-dr-amber font-tactical text-xs hover:text-dr-green transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${className ?? ''}`}
      >
        [DOSSIER]
      </button>

      <TacModalContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <TacModalHeader>
          <TacModalTitle>
            {view === 'list' ? 'DOSSIER LIBRARY' : selectedDossier?.codename}
          </TacModalTitle>
          <TacModalDescription>
            {view === 'list'
              ? 'Select a tactical briefing template'
              : selectedDossier?.name}
          </TacModalDescription>
        </TacModalHeader>

        {view === 'list' && (
          <div className="px-5 pb-5 space-y-2">
            {isPending && allDossiers.length === 0 && (
              <div className="text-dr-dim font-tactical text-sm py-8 text-center">
                Loading dossiers...
              </div>
            )}
            {allDossiers.map((dossier) => {
              const vars = parseVariables(dossier.variables);
              return (
                <button
                  key={dossier.id}
                  type="button"
                  onClick={() => handleSelect(dossier)}
                  className="w-full text-left bg-dr-bg border border-dr-border p-3 hover:border-dr-amber transition-colors group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-dr-amber font-tactical text-sm tracking-wider">
                        {dossier.codename}
                      </div>
                      <div className="text-dr-muted font-tactical text-xs mt-0.5">
                        {dossier.name}
                      </div>
                      {dossier.description && (
                        <div className="text-dr-dim font-tactical text-xs mt-1 line-clamp-2">
                          {dossier.description}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {vars.length > 0 && (
                        <span className="text-dr-dim font-tactical text-xs">
                          {vars.length} var{vars.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {dossier.assetCodename && (
                        <span className="text-dr-green font-tactical text-xs">
                          {dossier.assetCodename}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {view === 'form' && selectedDossier && (
          <>
            <div className="px-5 pb-5 space-y-4">
              {/* Template preview */}
              <div className="bg-dr-bg border border-dr-border p-3">
                <div className="text-dr-dim font-tactical text-xs tracking-wider mb-1">
                  TEMPLATE
                </div>
                <div className="text-dr-muted font-tactical text-xs whitespace-pre-wrap">
                  {selectedDossier.briefingTemplate}
                </div>
              </div>

              {/* Variable inputs */}
              {variables.length > 0 && (
                <div className="space-y-3">
                  <div className="text-dr-amber font-tactical text-xs tracking-wider">
                    VARIABLES
                  </div>
                  {variables.map((v) => (
                    <div key={v.key}>
                      <label className="block text-dr-text font-tactical text-xs mb-1">
                        {v.label}
                        <span className="text-dr-dim ml-2">{'{{' + v.key + '}}'}</span>
                      </label>
                      {v.description && (
                        <div className="text-dr-dim font-tactical text-xs mb-1">
                          {v.description}
                        </div>
                      )}
                      <TacInput
                        value={variableValues[v.key] ?? ''}
                        onChange={(e) =>
                          setVariableValues((prev) => ({
                            ...prev,
                            [v.key]: e.target.value,
                          }))
                        }
                        placeholder={v.placeholder}
                      />
                    </div>
                  ))}
                </div>
              )}

              {variables.length === 0 && (
                <div className="text-dr-dim font-tactical text-xs text-center py-2">
                  No variables — template will be applied as-is.
                </div>
              )}
            </div>

            <TacModalFooter>
              <TacButton variant="ghost" size="sm" onClick={handleBack}>
                BACK
              </TacButton>
              <TacButton
                variant="ghost"
                size="sm"
                onClick={() => handleOpenChange(false)}
              >
                CANCEL
              </TacButton>
              <TacButton
                variant="success"
                size="sm"
                onClick={handleApply}
                disabled={isPending}
              >
                APPLY
              </TacButton>
            </TacModalFooter>
          </>
        )}
      </TacModalContent>
    </TacModal>
  );
}

function parseVariables(raw: string | null): DossierVariable[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as DossierVariable[];
  } catch {
    return [];
  }
}
