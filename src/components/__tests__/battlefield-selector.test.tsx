import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BattlefieldSelector } from '@/components/layout/battlefield-selector';
import type { Battlefield } from '@/types';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/battlefields/bf-1/missions',
}));

function makeBattlefield(id: string, codename: string, status = 'active'): Battlefield {
  return {
    id,
    name: codename,
    codename,
    description: null,
    initialBriefing: null,
    repoPath: `/repos/${codename}`,
    defaultBranch: 'main',
    claudeMdPath: null,
    specMdPath: null,
    scaffoldCommand: null,
    scaffoldStatus: null,
    status,
    bootstrapMissionId: null,
    worktreeMode: 'none',
    autoStartDevServer: 0,
    devServerCommand: 'npm run dev',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as unknown as Battlefield;
}

describe('BattlefieldSelector', () => {
  it('renders empty state when no battlefields', () => {
    render(<BattlefieldSelector battlefields={[]} />);
    expect(screen.getByText('No battlefields')).toBeInTheDocument();
  });

  it('shows current battlefield codename from URL', () => {
    const battlefields = [
      makeBattlefield('bf-1', 'ALPHA'),
      makeBattlefield('bf-2', 'BRAVO'),
    ];
    render(<BattlefieldSelector battlefields={battlefields} />);
    expect(screen.getByText('ALPHA')).toBeInTheDocument();
  });

  it('shows dropdown with all battlefields on click', () => {
    const battlefields = [
      makeBattlefield('bf-1', 'ALPHA'),
      makeBattlefield('bf-2', 'BRAVO'),
      makeBattlefield('bf-3', 'CHARLIE'),
    ];
    render(<BattlefieldSelector battlefields={battlefields} />);

    // Click the trigger to open dropdown
    fireEvent.click(screen.getByText('ALPHA'));

    // All battlefields should appear in the dropdown
    expect(screen.getByText('BRAVO')).toBeInTheDocument();
    expect(screen.getByText('CHARLIE')).toBeInTheDocument();
  });

  it('renders gear icon linking to config when battlefield is selected', () => {
    const battlefields = [makeBattlefield('bf-1', 'ALPHA')];
    render(<BattlefieldSelector battlefields={battlefields} />);
    const gearLink = screen.getByTitle('Battlefield Config');
    expect(gearLink).toBeInTheDocument();
    expect(gearLink).toHaveAttribute('href', '/battlefields/bf-1/config');
  });

});
