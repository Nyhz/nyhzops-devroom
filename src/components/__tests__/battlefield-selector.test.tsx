import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BattlefieldSelector } from '@/components/layout/battlefield-selector';
import type { Battlefield } from '@/types';

// Mock the TacSelect components as simple HTML elements
vi.mock('@/components/ui/tac-select', () => ({
  TacSelect: ({ children, value, onValueChange }: { children: React.ReactNode; value: string; onValueChange: (v: string) => void }) => (
    <select data-testid="tac-select" value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  TacSelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TacSelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TacSelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  TacSelectValue: ({ placeholder }: { placeholder?: string }) => (
    <span data-testid="select-value">{placeholder}</span>
  ),
}));

function makeBattlefield(id: string, codename: string): Battlefield {
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
    status: 'active',
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

  it('does not render select when no battlefields', () => {
    render(<BattlefieldSelector battlefields={[]} />);
    expect(screen.queryByTestId('tac-select')).not.toBeInTheDocument();
  });

  it('renders battlefield list as options', () => {
    const battlefields = [
      makeBattlefield('bf-1', 'ALPHA'),
      makeBattlefield('bf-2', 'BRAVO'),
      makeBattlefield('bf-3', 'CHARLIE'),
    ];
    render(<BattlefieldSelector battlefields={battlefields} />);

    expect(screen.getByText('ALPHA')).toBeInTheDocument();
    expect(screen.getByText('BRAVO')).toBeInTheDocument();
    expect(screen.getByText('CHARLIE')).toBeInTheDocument();
  });

  it('renders select element when battlefields exist', () => {
    const battlefields = [makeBattlefield('bf-1', 'ALPHA')];
    render(<BattlefieldSelector battlefields={battlefields} />);
    expect(screen.getByTestId('tac-select')).toBeInTheDocument();
  });

  it('renders the correct number of options', () => {
    const battlefields = [
      makeBattlefield('bf-1', 'ALPHA'),
      makeBattlefield('bf-2', 'BRAVO'),
    ];
    const { container } = render(<BattlefieldSelector battlefields={battlefields} />);
    const options = container.querySelectorAll('option');
    expect(options).toHaveLength(2);
  });
});
