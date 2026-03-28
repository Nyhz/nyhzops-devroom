import { cn } from '@/lib/utils';

interface PageWrapperProps {
  children: React.ReactNode;
  className?: string;
  maxWidth?: boolean;  // Apply max-width constraint (for forms)
  breadcrumb?: string | string[];
  title?: string;
  actions?: React.ReactNode;
}

export function PageWrapper({ children, className, maxWidth, breadcrumb, title, actions }: PageWrapperProps) {
  const breadcrumbText = Array.isArray(breadcrumb)
    ? breadcrumb.join(' // ')
    : breadcrumb;

  return (
    <div
      className={cn(
        'p-8 space-y-6',
        maxWidth && 'max-w-3xl',
        className,
      )}
    >
      {(breadcrumbText || title) && (
        <div className="space-y-1">
          {breadcrumbText && (
            <p className="text-xs font-tactical tracking-widest uppercase text-dr-muted">
              {breadcrumbText}
            </p>
          )}
          {title && (
            <div className="flex items-center justify-between">
              <h1 className="text-lg font-tactical tracking-wider text-dr-text">
                {title}
              </h1>
              {actions && <div className="flex items-center gap-2">{actions}</div>}
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
