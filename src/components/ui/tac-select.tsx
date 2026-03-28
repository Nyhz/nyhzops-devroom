"use client"

import * as React from 'react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/* Re-export base parts unchanged */
export { Select as TacSelect, SelectGroup as TacSelectGroup, SelectLabel as TacSelectLabel, SelectSeparator as TacSelectSeparator, SelectValue as TacSelectValue };

/* Styled trigger */
export function TacSelectTrigger({
  className,
  ...props
}: React.ComponentProps<typeof SelectTrigger>) {
  return (
    <SelectTrigger
      className={cn(
        'bg-dr-bg border-dr-border text-dr-text font-tactical',
        'focus-visible:border-dr-amber focus-visible:ring-dr-amber/30',
        'data-placeholder:text-dr-muted',
        className,
      )}
      {...props}
    />
  );
}

/* Styled content dropdown */
export function TacSelectContent({
  className,
  ...props
}: React.ComponentProps<typeof SelectContent>) {
  return (
    <SelectContent
      className={cn(
        'bg-dr-surface border-dr-border text-dr-text font-tactical',
        className,
      )}
      {...props}
    />
  );
}

/* Styled item */
export function TacSelectItem({
  className,
  ...props
}: React.ComponentProps<typeof SelectItem>) {
  return (
    <SelectItem
      className={cn(
        'text-dr-text font-tactical focus:bg-dr-elevated focus:text-dr-amber',
        className,
      )}
      {...props}
    />
  );
}
