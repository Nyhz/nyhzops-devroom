'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { updateGateManifest, establishGates } from '@/actions/battlefield';
import { TacCard } from '@/components/ui/tac-card';
import { TacInput } from '@/components/ui/tac-input';
import { TacButton } from '@/components/ui/tac-button';
import { cn } from '@/lib/utils';
import type { GateManifest, GateResult } from '@/control/gates';

interface GateManifestEditorProps {
  battlefieldId: string;
  initialManifest: GateManifest | null;
  className?: string;
}

type GateKey = keyof GateManifest;

const GATE_KEYS: GateKey[] = ['build', 'test', 'lint', 'typecheck'];

const GATE_LABELS: Record<GateKey, string> = {
  build: 'BUILD',
  test: 'TEST',
  lint: 'LINT',
  typecheck: 'TYPECHECK',
};

function statusColor(status: GateResult['status']): string {
  switch (status) {
    case 'pass':
      return 'text-dr-green';
    case 'fail':
      return 'text-dr-red';
    case 'skipped':
      return 'text-dr-dim';
    case 'timeout':
    case 'command-missing':
      return 'text-dr-amber';
    default:
      return 'text-dr-muted';
  }
}

function statusLabel(status: GateResult['status']): string {
  switch (status) {
    case 'pass':
      return 'PASS';
    case 'fail':
      return 'FAIL';
    case 'skipped':
      return 'SKIPPED';
    case 'timeout':
      return 'TIMEOUT';
    case 'command-missing':
      return 'CMD MISSING';
  }
}

export function GateManifestEditor({
  battlefieldId,
  initialManifest,
  className,
}: GateManifestEditorProps) {
  const [commands, setCommands] = useState<Record<GateKey, string>>({
    build: initialManifest?.build ?? '',
    test: initialManifest?.test ?? '',
    lint: initialManifest?.lint ?? '',
    typecheck: initialManifest?.typecheck ?? '',
  });

  const [verifyResults, setVerifyResults] = useState<GateResult[] | null>(null);
  const [verifyPassed, setVerifyPassed] = useState(false);
  const [allowUnverified, setAllowUnverified] = useState(false);
  const [verifyError, setVerifyError] = useState('');

  const [isVerifying, startVerify] = useTransition();
  const [isSaving, startSave] = useTransition();
  const [isAutoDetecting, startAutoDetect] = useTransition();

  function buildManifest(): GateManifest {
    return {
      build: commands.build.trim() || null,
      test: commands.test.trim() || null,
      lint: commands.lint.trim() || null,
      typecheck: commands.typecheck.trim() || null,
    };
  }

  function handleCommandChange(gate: GateKey, value: string) {
    setCommands((prev) => ({ ...prev, [gate]: value }));
    // Reset verify state when manifest changes
    setVerifyPassed(false);
    setVerifyResults(null);
    setVerifyError('');
  }

  function handleVerify() {
    setVerifyError('');
    startVerify(async () => {
      try {
        const result = await updateGateManifest(
          battlefieldId,
          buildManifest(),
          { verify: true },
        );
        setVerifyResults(result.verifyResults?.results ?? null);
        const passed = result.verifyResults?.overallStatus === 'pass';
        setVerifyPassed(passed);
        if (passed) {
          toast.success('GATE VERIFY — All gates green. Manifest saved.');
        } else {
          toast.error('GATE VERIFY — One or more gates failed. Manifest not saved.');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setVerifyError(msg);
        toast.error(`GATE VERIFY FAILED — ${msg}`);
      }
    });
  }

  function handleSave() {
    startSave(async () => {
      try {
        await updateGateManifest(battlefieldId, buildManifest());
        toast.success('GATE MANIFEST — Saved (no verification).');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`SAVE FAILED — ${msg}`);
      }
    });
  }

  function handleAutoDetect() {
    startAutoDetect(async () => {
      try {
        await establishGates(battlefieldId);
        toast.success('AUTO-DETECT — Bootstrap pipeline started. Gate manifest will update shortly.');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`AUTO-DETECT FAILED — ${msg}`);
      }
    });
  }

  const saveEnabled = verifyPassed || allowUnverified;
  const isBusy = isVerifying || isSaving || isAutoDetecting;

  return (
    <TacCard status="amber" className={cn('space-y-5', className)}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-tactical uppercase tracking-wider text-dr-amber">
          Gate Manifest
        </h2>
        <span className="text-xs font-data text-dr-dim uppercase tracking-wider">
          Commands run against HEAD to verify integrity
        </span>
      </div>

      <div className="grid gap-4">
        {GATE_KEYS.map((gate) => (
          <div key={gate} className="space-y-1">
            <label
              htmlFor={`gate-${gate}`}
              className="block text-xs font-tactical uppercase tracking-wider text-dr-muted"
            >
              {GATE_LABELS[gate]}
            </label>
            <TacInput
              id={`gate-${gate}`}
              value={commands[gate]}
              onChange={(e) => handleCommandChange(gate, e.target.value)}
              placeholder={`e.g. pnpm ${gate}`}
              disabled={isBusy}
            />
          </div>
        ))}
      </div>

      {/* Verify results */}
      {verifyResults && verifyResults.length > 0 && (
        <div className="border border-dr-border bg-dr-bg p-4 space-y-2">
          <p className="text-xs font-tactical uppercase tracking-wider text-dr-dim mb-2">
            Verify Results
          </p>
          {verifyResults.map((r) => (
            <div
              key={r.gate}
              className="flex items-center justify-between text-xs font-data"
            >
              <span className="uppercase text-dr-muted">{r.gate}</span>
              <div className="flex items-center gap-4">
                {r.durationMs > 0 && (
                  <span className="text-dr-dim">{r.durationMs}ms</span>
                )}
                <span className={cn('uppercase font-tactical', statusColor(r.status))}>
                  {statusLabel(r.status)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Verify error */}
      {verifyError && (
        <p className="text-xs font-data text-dr-red border border-dr-red/30 bg-dr-red/5 p-3">
          {verifyError}
        </p>
      )}

      {/* ALLOW UNVERIFIED SAVE toggle */}
      <label className="flex items-center gap-3 cursor-pointer select-none group w-fit">
        <div
          role="checkbox"
          aria-checked={allowUnverified}
          aria-label="ALLOW UNVERIFIED SAVE"
          tabIndex={0}
          onClick={() => setAllowUnverified((v) => !v)}
          onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') setAllowUnverified((v) => !v); }}
          className={cn(
            'relative w-10 h-5 border transition-all cursor-pointer',
            allowUnverified
              ? 'bg-dr-amber/20 border-dr-amber'
              : 'bg-dr-bg border-dr-border',
          )}
        >
          <div
            className={cn(
              'absolute top-0.5 w-4 h-4 transition-all',
              allowUnverified
                ? 'left-5 bg-dr-amber'
                : 'left-0.5 bg-dr-dim',
            )}
          />
        </div>
        <span className="text-xs font-tactical uppercase tracking-wider text-dr-muted group-hover:text-dr-text transition-colors">
          Allow Unverified Save
        </span>
      </label>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3 pt-1">
        <TacButton
          variant="primary"
          size="sm"
          onClick={handleVerify}
          disabled={isBusy}
        >
          {isVerifying ? 'VERIFYING…' : 'Verify Against Head'}
        </TacButton>

        <TacButton
          variant="success"
          size="sm"
          onClick={handleSave}
          disabled={!saveEnabled || isBusy}
        >
          {isSaving ? 'SAVING…' : 'Save'}
        </TacButton>

        <TacButton
          variant="ghost"
          size="sm"
          onClick={handleAutoDetect}
          disabled={isBusy}
        >
          {isAutoDetecting ? 'DETECTING…' : 'Auto-Detect (EstablishGates)'}
        </TacButton>
      </div>
    </TacCard>
  );
}
