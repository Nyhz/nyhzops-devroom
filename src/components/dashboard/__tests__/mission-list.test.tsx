import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { MissionList } from '../mission-list';

// Mock formatRelativeTime to return a stable value
vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return {
    ...actual,
    formatRelativeTime: () => '5m ago',
  };
});

// Mock lucide-react icons used by SearchInput
vi.mock('lucide-react', () => ({
  Search: () => null,
}));

const now = Date.now();

const makeMission = (overrides: {
  id?: string;
  title?: string | null;
  status?: string | null;
  priority?: string | null;
  iterations?: number | null;
  assetCodename?: string | null;
  createdAt?: number;
} = {}) => ({
  id: overrides.id ?? 'mission-1',
  title: 'title' in overrides ? overrides.title! : 'Test Mission',
  status: 'status' in overrides ? overrides.status! : 'standby',
  priority: overrides.priority ?? 'normal',
  iterations: 'iterations' in overrides ? overrides.iterations! : 1,
  assetCodename: 'assetCodename' in overrides ? overrides.assetCodename! : 'ALPHA',
  createdAt: overrides.createdAt ?? now,
});

const baseProps = {
  battlefieldId: 'bf-1',
  missions: [] as ReturnType<typeof makeMission>[],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MissionList', () => {
  describe('rendering', () => {
    it('renders MISSIONS header', () => {
      renderWithProviders(<MissionList {...baseProps} missions={[]} />);
      expect(screen.getByText('MISSIONS')).toBeInTheDocument();
    });

    it('shows empty state when no missions exist', () => {
      renderWithProviders(<MissionList {...baseProps} missions={[]} />);
      expect(screen.getByText(/no missions deployed yet/i)).toBeInTheDocument();
    });

    it('renders a list of missions', () => {
      const missions = [
        makeMission({ id: 'm1', title: 'Alpha Strike' }),
        makeMission({ id: 'm2', title: 'Beta Recon' }),
      ];
      renderWithProviders(<MissionList {...baseProps} missions={missions} />);

      expect(screen.getByText('Alpha Strike')).toBeInTheDocument();
      expect(screen.getByText('Beta Recon')).toBeInTheDocument();
    });

    it('renders mission with null title as Untitled Mission', () => {
      const missions = [makeMission({ title: null })];
      renderWithProviders(<MissionList {...baseProps} missions={missions} />);
      expect(screen.getByText('Untitled Mission')).toBeInTheDocument();
    });

    it('shows asset codename', () => {
      const missions = [makeMission({ assetCodename: 'BRAVO' })];
      renderWithProviders(<MissionList {...baseProps} missions={missions} />);
      expect(screen.getByText(/BRAVO/)).toBeInTheDocument();
    });

    it('shows UNASSIGNED when assetCodename is null', () => {
      const missions = [makeMission({ assetCodename: null })];
      renderWithProviders(<MissionList {...baseProps} missions={missions} />);
      expect(screen.getByText(/UNASSIGNED/)).toBeInTheDocument();
    });

    it('shows iteration count when > 1', () => {
      const missions = [makeMission({ iterations: 3 })];
      renderWithProviders(<MissionList {...baseProps} missions={missions} />);
      expect(screen.getByText(/×3/)).toBeInTheDocument();
    });

    it('does not show iteration count when 1 or null', () => {
      const missions = [makeMission({ iterations: 1 })];
      renderWithProviders(<MissionList {...baseProps} missions={missions} />);
      expect(screen.queryByText(/×/)).not.toBeInTheDocument();
    });

    it('renders VIEW link for each mission', () => {
      const missions = [makeMission({ id: 'm1' })];
      renderWithProviders(<MissionList {...baseProps} missions={missions} />);

      const viewLink = screen.getByText('VIEW');
      expect(viewLink).toBeInTheDocument();
      expect(viewLink.closest('a')).toHaveAttribute(
        'href',
        '/battlefields/bf-1/missions/m1',
      );
    });

    it('renders status badge for each mission', () => {
      const missions = [makeMission({ status: 'in_combat' })];
      renderWithProviders(<MissionList {...baseProps} missions={missions} />);
      expect(screen.getByText('IN COMBAT')).toBeInTheDocument();
    });
  });

  describe('search filtering', () => {
    it('filters missions by title search', async () => {
      const missions = [
        makeMission({ id: 'm1', title: 'Deploy API' }),
        makeMission({ id: 'm2', title: 'Fix Database' }),
        makeMission({ id: 'm3', title: 'Deploy Frontend' }),
      ];

      const { user } = renderWithProviders(
        <MissionList {...baseProps} missions={missions} />,
      );

      const searchInput = screen.getByPlaceholderText('Search missions...');
      await user.type(searchInput, 'Deploy');

      expect(screen.getByText('Deploy API')).toBeInTheDocument();
      expect(screen.getByText('Deploy Frontend')).toBeInTheDocument();
      expect(screen.queryByText('Fix Database')).not.toBeInTheDocument();
    });

    it('shows no-match message when search has no results', async () => {
      const missions = [makeMission({ id: 'm1', title: 'Alpha' })];

      const { user } = renderWithProviders(
        <MissionList {...baseProps} missions={missions} />,
      );

      const searchInput = screen.getByPlaceholderText('Search missions...');
      await user.type(searchInput, 'zzzzz');

      expect(screen.getByText(/no missions match your search/i)).toBeInTheDocument();
    });

    it('is case-insensitive', async () => {
      const missions = [makeMission({ id: 'm1', title: 'Deploy API' })];

      const { user } = renderWithProviders(
        <MissionList {...baseProps} missions={missions} />,
      );

      const searchInput = screen.getByPlaceholderText('Search missions...');
      await user.type(searchInput, 'deploy api');

      expect(screen.getByText('Deploy API')).toBeInTheDocument();
    });

    it('shows all missions when search is cleared', async () => {
      const missions = [
        makeMission({ id: 'm1', title: 'Alpha' }),
        makeMission({ id: 'm2', title: 'Beta' }),
      ];

      const { user } = renderWithProviders(
        <MissionList {...baseProps} missions={missions} />,
      );

      const searchInput = screen.getByPlaceholderText('Search missions...');
      await user.type(searchInput, 'Alpha');
      expect(screen.queryByText('Beta')).not.toBeInTheDocument();

      await user.clear(searchInput);
      expect(screen.getByText('Alpha')).toBeInTheDocument();
      expect(screen.getByText('Beta')).toBeInTheDocument();
    });
  });
});
