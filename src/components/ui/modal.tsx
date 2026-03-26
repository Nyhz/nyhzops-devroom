"use client"

import * as React from 'react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/* Re-export base parts unchanged */
export { Dialog as TacModal, DialogTrigger as TacModalTrigger, DialogClose as TacModalClose };

export function TacModalContent({
  className,
  ...props
}: React.ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      className={cn(
        'bg-dr-surface border border-dr-border text-dr-text font-tactical',
        className,
      )}
      {...props}
    />
  );
}

export function TacModalHeader({
  className,
  ...props
}: React.ComponentProps<typeof DialogHeader>) {
  return <DialogHeader className={cn(className)} {...props} />;
}

export function TacModalTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogTitle>) {
  return (
    <DialogTitle
      className={cn('text-dr-amber font-tactical uppercase tracking-wider', className)}
      {...props}
    />
  );
}

export function TacModalDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogDescription>) {
  return (
    <DialogDescription className={cn('text-dr-muted', className)} {...props} />
  );
}

export function TacModalFooter({
  className,
  ...props
}: React.ComponentProps<typeof DialogFooter>) {
  return (
    <DialogFooter
      className={cn(
        'border-t-dr-border bg-dr-elevated',
        className,
      )}
      {...props}
    />
  );
}
