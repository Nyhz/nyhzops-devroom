import { TacButton } from '@/components/ui/tac-button';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      {/* Amber alert banner */}
      <div className="w-full max-w-xl bg-dr-amber/10 border border-dr-amber p-4 mb-6">
        <div className="text-dr-amber font-tactical text-sm tracking-widest uppercase text-center">
          SECTOR NOT FOUND — 404
        </div>
      </div>

      {/* Message */}
      <div className="text-dr-text font-tactical text-sm text-center mb-2">
        Commander, the requested sector does not exist.
      </div>
      <div className="text-dr-dim font-data text-xs text-center mb-8">
        The target coordinates yielded no results. Verify your route and try again.
      </div>

      {/* Return to HQ */}
      <Link href="/">
        <TacButton variant="primary">
          RETURN TO HQ
        </TacButton>
      </Link>
    </div>
  );
}
