import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { PlanEditor } from '../plan-editor';
import type { PlanJSON } from '@/types';

// Mock updateBattlePlan
const mockUpdateBattlePlan = vi.fn().mockResolvedValue(undefined);
vi.mock('@/actions/campaign-plan', () => ({
  updateBattlePlan: (...args: unknown[]) => mockUpdateBattlePlan(...args),
}));

// Mock @dnd-kit/core — render children without DnD behavior
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  closestCenter: vi.fn(),
  DragOverlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PointerSensor: vi.fn(),
  useSensor: vi.fn(),
  useSensors: () => [],
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  verticalListSortingStrategy: 'vertical',
  horizontalListSortingStrategy: 'horizontal',
  arrayMove: (arr: unknown[], from: number, to: number) => {
    const result = [...arr];
    const [removed] = result.splice(from, 1);
    result.splice(to, 0, removed);
    return result;
  },
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: () => null,
    },
  },
}));

const emptyPlan: PlanJSON = { summary: '', phases: [] };
const assets = [
  { id: 'a1', codename: 'PHANTOM', specialty: 'Recon' },
  { id: 'a2', codename: 'VIPER', specialty: 'Strike' },
];

function planWithPhases(): PlanJSON {
  return {
    summary: 'Test plan',
    phases: [
      {
        name: 'Recon',
        objective: 'Gather intel',
        missions: [
          {
            title: 'Scout East',
            briefing: 'Check east flank',
            assetCodename: 'PHANTOM',
            priority: 'normal',
            dependsOn: [],
          },
        ],
      },
      {
        name: 'Strike',
        objective: 'Hit targets',
        missions: [],
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PlanEditor', () => {
  it('renders BATTLE PLAN EDITOR header', () => {
    renderWithProviders(
      <PlanEditor campaignId="c1" initialPlan={emptyPlan} assets={assets} />,
    );
    expect(screen.getByText('BATTLE PLAN EDITOR')).toBeInTheDocument();
  });

  it('renders plan summary textarea', () => {
    renderWithProviders(
      <PlanEditor campaignId="c1" initialPlan={planWithPhases()} assets={assets} />,
    );
    const textarea = screen.getByPlaceholderText('Campaign plan summary...');
    expect(textarea).toHaveValue('Test plan');
  });

  it('renders ADD PHASE button', () => {
    renderWithProviders(
      <PlanEditor campaignId="c1" initialPlan={emptyPlan} assets={assets} />,
    );
    expect(screen.getByText('+ ADD PHASE')).toBeInTheDocument();
  });

  it('renders phases with names', () => {
    renderWithProviders(
      <PlanEditor campaignId="c1" initialPlan={planWithPhases()} assets={assets} />,
    );
    expect(screen.getByText('PHASE 1')).toBeInTheDocument();
    expect(screen.getByText('PHASE 2')).toBeInTheDocument();
    expect(screen.getByText('Recon')).toBeInTheDocument();
    expect(screen.getByText('Strike')).toBeInTheDocument();
  });

  it('renders mission titles within phases', () => {
    renderWithProviders(
      <PlanEditor campaignId="c1" initialPlan={planWithPhases()} assets={assets} />,
    );
    expect(screen.getByText('Scout East')).toBeInTheDocument();
  });

  it('renders mission count per phase', () => {
    renderWithProviders(
      <PlanEditor campaignId="c1" initialPlan={planWithPhases()} assets={assets} />,
    );
    expect(screen.getByText('1 mission')).toBeInTheDocument();
    expect(screen.getByText('0 missions')).toBeInTheDocument();
  });

  it('renders ADD MISSION buttons for each phase', () => {
    renderWithProviders(
      <PlanEditor campaignId="c1" initialPlan={planWithPhases()} assets={assets} />,
    );
    const addMissionButtons = screen.getAllByText('+ ADD MISSION');
    expect(addMissionButtons).toHaveLength(2);
  });

  it('adds a new phase when ADD PHASE is clicked', async () => {
    const { user } = renderWithProviders(
      <PlanEditor campaignId="c1" initialPlan={emptyPlan} assets={assets} />,
    );
    await user.click(screen.getByText('+ ADD PHASE'));
    expect(screen.getByText('PHASE 1')).toBeInTheDocument();
    expect(screen.getByText('+ ADD MISSION')).toBeInTheDocument();
  });

  it('adds a mission to a phase when ADD MISSION is clicked', async () => {
    const { user } = renderWithProviders(
      <PlanEditor
        campaignId="c1"
        initialPlan={{ summary: '', phases: [{ name: 'Alpha', objective: '', missions: [] }] }}
        assets={assets}
      />,
    );
    expect(screen.getByText('0 missions')).toBeInTheDocument();
    await user.click(screen.getByText('+ ADD MISSION'));
    expect(screen.getByText('1 mission')).toBeInTheDocument();
  });

  it('shows UNSAVED CHANGES after editing summary', async () => {
    const { user } = renderWithProviders(
      <PlanEditor campaignId="c1" initialPlan={emptyPlan} assets={assets} />,
    );
    expect(screen.queryByText(/UNSAVED CHANGES/)).not.toBeInTheDocument();
    const textarea = screen.getByPlaceholderText('Campaign plan summary...');
    await user.type(textarea, 'New summary');
    expect(screen.getByText(/UNSAVED CHANGES/)).toBeInTheDocument();
  });

  it('SAVE PLAN button is disabled when no changes', () => {
    renderWithProviders(
      <PlanEditor campaignId="c1" initialPlan={emptyPlan} assets={assets} />,
    );
    expect(screen.getByRole('button', { name: 'SAVE PLAN' })).toBeDisabled();
  });

  it('SAVE PLAN button is enabled after changes', async () => {
    const { user } = renderWithProviders(
      <PlanEditor campaignId="c1" initialPlan={emptyPlan} assets={assets} />,
    );
    await user.type(screen.getByPlaceholderText('Campaign plan summary...'), 'x');
    expect(screen.getByRole('button', { name: 'SAVE PLAN' })).not.toBeDisabled();
  });

  it('calls updateBattlePlan on save', async () => {
    const { user } = renderWithProviders(
      <PlanEditor campaignId="c1" initialPlan={emptyPlan} assets={assets} />,
    );
    await user.type(screen.getByPlaceholderText('Campaign plan summary...'), 'Updated');
    await user.click(screen.getByRole('button', { name: 'SAVE PLAN' }));
    await waitFor(() => {
      expect(mockUpdateBattlePlan).toHaveBeenCalledWith('c1', expect.objectContaining({
        summary: 'Updated',
      }));
    });
  });

  it('shows save error when updateBattlePlan fails', async () => {
    mockUpdateBattlePlan.mockRejectedValueOnce(new Error('Save failed'));
    const { user } = renderWithProviders(
      <PlanEditor campaignId="c1" initialPlan={emptyPlan} assets={assets} />,
    );
    await user.type(screen.getByPlaceholderText('Campaign plan summary...'), 'x');
    await user.click(screen.getByRole('button', { name: 'SAVE PLAN' }));
    await waitFor(() => {
      expect(screen.getByText('Save failed')).toBeInTheDocument();
    });
  });

  it('clears dirty state after successful save', async () => {
    const { user } = renderWithProviders(
      <PlanEditor campaignId="c1" initialPlan={emptyPlan} assets={assets} />,
    );
    await user.type(screen.getByPlaceholderText('Campaign plan summary...'), 'x');
    expect(screen.getByText(/UNSAVED CHANGES/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'SAVE PLAN' }));
    await waitFor(() => {
      expect(screen.queryByText(/UNSAVED CHANGES/)).not.toBeInTheDocument();
    });
  });

  it('renders asset selector options within missions', () => {
    renderWithProviders(
      <PlanEditor campaignId="c1" initialPlan={planWithPhases()} assets={assets} />,
    );
    const selects = screen.getAllByRole('combobox');
    // The first combobox in the mission should be the asset selector
    const assetSelect = selects.find((s) => {
      const options = s.querySelectorAll('option');
      return Array.from(options).some((o) => o.textContent === 'PHANTOM');
    });
    expect(assetSelect).toBeDefined();
  });

  it('renders priority selector within missions', () => {
    renderWithProviders(
      <PlanEditor campaignId="c1" initialPlan={planWithPhases()} assets={assets} />,
    );
    const selects = screen.getAllByRole('combobox');
    const prioritySelect = selects.find((s) => {
      const options = s.querySelectorAll('option');
      return Array.from(options).some((o) => o.textContent === 'CRITICAL');
    });
    expect(prioritySelect).toBeDefined();
  });

  it('marks dirty when adding a phase', async () => {
    const { user } = renderWithProviders(
      <PlanEditor campaignId="c1" initialPlan={emptyPlan} assets={assets} />,
    );
    await user.click(screen.getByText('+ ADD PHASE'));
    expect(screen.getByText(/UNSAVED CHANGES/)).toBeInTheDocument();
  });
});
