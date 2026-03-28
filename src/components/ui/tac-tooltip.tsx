'use client';

import { Tooltip } from 'react-tooltip';
import 'react-tooltip/dist/react-tooltip.css';

/**
 * TacTooltipProvider — render once in the app layout or in any page that uses tooltips.
 * All tooltips with data-tooltip-id="tac" will use this provider.
 */
export function TacTooltipProvider() {
  return (
    <Tooltip
      id="tac"
      className="!bg-dr-elevated !border !border-dr-border !text-dr-text !font-data !text-xs !px-3 !py-2 !rounded-none !opacity-100 !max-w-xs !z-50"
      place="top"
      delayShow={300}
    />
  );
}

/**
 * Helper props to add to any element that should show a tooltip.
 * Usage: <button {...tacTooltip("Tooltip text here")} />
 */
export function tacTooltip(content: string) {
  return {
    'data-tooltip-id': 'tac',
    'data-tooltip-content': content,
  } as const;
}
