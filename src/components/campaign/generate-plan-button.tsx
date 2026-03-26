'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TacButton } from '@/components/ui/tac-button';
import { generateBattlePlan } from '@/actions/campaign';

interface GeneratePlanButtonProps {
  campaignId: string;
  className?: string;
}

export function GeneratePlanButton({ campaignId, className }: GeneratePlanButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      await generateBattlePlan(campaignId);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate battle plan');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={className}>
      <TacButton
        onClick={handleGenerate}
        disabled={loading}
        variant="primary"
        size="lg"
      >
        {loading ? (
          <span className="animate-pulse">GENERATING BATTLE PLAN...</span>
        ) : (
          'GENERATE BATTLE PLAN'
        )}
      </TacButton>
      {error && (
        <div className="mt-3 flex items-center gap-3">
          <span className="font-tactical text-xs text-dr-red">{error}</span>
          <TacButton
            onClick={handleGenerate}
            disabled={loading}
            variant="danger"
            size="sm"
          >
            RETRY
          </TacButton>
        </div>
      )}
    </div>
  );
}
