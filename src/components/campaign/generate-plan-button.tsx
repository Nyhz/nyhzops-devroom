'use client';

import { TacButton } from '@/components/ui/tac-button';

interface GeneratePlanButtonProps {
  campaignId: string;
  className?: string;
}

/**
 * Legacy button — plan generation now happens via the briefing chat flow.
 * This placeholder remains until Task 10 rewires the campaign detail page.
 */
export function GeneratePlanButton({ campaignId, className }: GeneratePlanButtonProps) {
  return (
    <div className={className}>
      <TacButton variant="primary" size="lg" disabled>
        GENERATE BATTLE PLAN (USE BRIEFING)
      </TacButton>
    </div>
  );
}
