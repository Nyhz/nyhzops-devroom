import { forwardRef, type InputHTMLAttributes } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

type SearchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, ...props }, ref) => (
    <div className={cn('relative', className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-dr-muted pointer-events-none" />
      <input
        ref={ref}
        type="text"
        className={cn(
          'w-full bg-dr-surface border border-dr-border text-dr-text font-tactical text-sm',
          'pl-9 pr-3 py-2 placeholder:text-dr-muted',
          'focus:border-dr-amber focus:outline-none',
        )}
        {...props}
      />
    </div>
  ),
);
SearchInput.displayName = 'SearchInput';
