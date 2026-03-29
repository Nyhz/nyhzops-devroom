import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface TacButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'success' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

const variantStyles = {
  primary: 'border-dr-amber text-dr-amber hover:bg-dr-amber/10 hover:shadow-glow-amber',
  success: 'border-dr-green text-dr-green hover:bg-dr-green/10 hover:shadow-glow-green',
  danger: 'border-dr-red text-dr-red hover:bg-dr-red/10 hover:shadow-glow-red',
  ghost: 'border-dr-border text-dr-muted hover:text-dr-text hover:border-dr-dim',
} as const;

const sizeStyles = {
  sm: 'px-4 py-2 text-sm min-h-[44px] md:min-h-0',
  md: 'px-5 py-2.5 text-base',
  lg: 'px-8 py-3.5 text-base',
} as const;

export const TacButton = forwardRef<HTMLButtonElement, TacButtonProps>(
  ({ className, variant = 'primary', size = 'md', disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'border font-tactical uppercase tracking-wider transition-all',
        'disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:shadow-none',
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      disabled={disabled}
      {...props}
    />
  ),
);
TacButton.displayName = 'TacButton';
