import { cn } from '@/lib/utils';

interface PageWrapperProps {
  children: React.ReactNode;
  className?: string;
  maxWidth?: boolean;  // Apply max-width constraint (for forms)
}

export function PageWrapper({ children, className, maxWidth }: PageWrapperProps) {
  return (
    <div
      className={cn(
        'p-8 space-y-6',
        maxWidth && 'max-w-3xl',
        className,
      )}
    >
      {children}
    </div>
  );
}
