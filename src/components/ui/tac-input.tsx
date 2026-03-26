import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const TacInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'w-full bg-dr-bg border border-dr-border text-dr-text font-tactical text-sm',
        'px-3 py-2 placeholder:text-dr-dim',
        'focus:border-dr-amber focus:outline-none',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    />
  ),
);
TacInput.displayName = 'TacInput';

export const TacTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full bg-dr-bg border border-dr-border text-dr-text font-tactical text-sm',
        'px-3 py-2 placeholder:text-dr-dim resize-vertical min-h-[80px]',
        'focus:border-dr-amber focus:outline-none',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    />
  ),
);
TacTextarea.displayName = 'TacTextarea';
