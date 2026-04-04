import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { CampaignControls } from '../campaign-controls';

// Mock campaign actions
const mockLaunchCampaign = vi.fn().mockResolvedValue(undefined);
const mockAbandonCampaign = vi.fn().mockResolvedValue(undefined);
const mockCompleteCampaign = vi.fn().mockResolvedValue(undefined);
const mockDeleteCampaign = vi.fn().mockResolvedValue(undefined);
const mockBackToDraft = vi.fn().mockResolvedValue(undefined);

vi.mock('@/actions/campaign', () => ({
  launchCampaign: (...args: unknown[]) => mockLaunchCampaign(...args),
  abandonCampaign: (...args: unknown[]) => mockAbandonCampaign(...args),
  completeCampaign: (...args: unknown[]) => mockCompleteCampaign(...args),
  deleteCampaign: (...args: unknown[]) => mockDeleteCampaign(...args),
}));

vi.mock('@/actions/campaign-plan', () => ({
  backToDraft: (...args: unknown[]) => mockBackToDraft(...args),
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock useConfirm — resolve immediately with action index 0 (confirm)
let confirmResult = 0;
vi.mock('@/hooks/use-confirm', () => ({
  useConfirm: () => {
    const confirm = vi.fn().mockImplementation(() => Promise.resolve(confirmResult));
    const ConfirmDialog = () => null;
    return [confirm, ConfirmDialog];
  },
}));

const baseProps = {
  campaignId: 'camp-1',
  battlefieldId: 'bf-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  confirmResult = 0;
});

describe('CampaignControls', () => {
  describe('draft status', () => {
    it('renders DELETE button only', () => {
      renderWithProviders(<CampaignControls {...baseProps} status="draft" />);
      expect(screen.getByRole('button', { name: 'DELETE' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'GREEN LIGHT' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'ABANDON' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'MISSION ACCOMPLISHED' })).not.toBeInTheDocument();
    });

    it('calls deleteCampaign on delete', async () => {
      const { user } = renderWithProviders(
        <CampaignControls {...baseProps} status="draft" />,
      );
      await user.click(screen.getByRole('button', { name: 'DELETE' }));
      await waitFor(() => {
        expect(mockDeleteCampaign).toHaveBeenCalledWith('camp-1');
      });
    });
  });

  describe('planning status', () => {
    it('renders GREEN LIGHT, BACK TO BRIEFING, and DELETE buttons', () => {
      renderWithProviders(<CampaignControls {...baseProps} status="planning" />);
      expect(screen.getByRole('button', { name: 'GREEN LIGHT' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'BACK TO BRIEFING' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'DELETE' })).toBeInTheDocument();
    });

    it('calls launchCampaign on green light', async () => {
      const { user } = renderWithProviders(
        <CampaignControls {...baseProps} status="planning" />,
      );
      await user.click(screen.getByRole('button', { name: 'GREEN LIGHT' }));
      await waitFor(() => {
        expect(mockLaunchCampaign).toHaveBeenCalledWith('camp-1');
      });
    });

    it('calls backToDraft on back to briefing', async () => {
      const { user } = renderWithProviders(
        <CampaignControls {...baseProps} status="planning" />,
      );
      await user.click(screen.getByRole('button', { name: 'BACK TO BRIEFING' }));
      await waitFor(() => {
        expect(mockBackToDraft).toHaveBeenCalledWith('camp-1');
      });
    });
  });

  describe('active status', () => {
    it('renders MISSION ACCOMPLISHED and ABANDON buttons', () => {
      renderWithProviders(<CampaignControls {...baseProps} status="active" />);
      expect(screen.getByRole('button', { name: 'MISSION ACCOMPLISHED' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'ABANDON' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'DELETE' })).not.toBeInTheDocument();
    });

    it('calls completeCampaign on mission accomplished', async () => {
      const { user } = renderWithProviders(
        <CampaignControls {...baseProps} status="active" />,
      );
      await user.click(screen.getByRole('button', { name: 'MISSION ACCOMPLISHED' }));
      await waitFor(() => {
        expect(mockCompleteCampaign).toHaveBeenCalledWith('camp-1');
      });
    });

    it('calls abandonCampaign on abandon', async () => {
      const { user } = renderWithProviders(
        <CampaignControls {...baseProps} status="active" />,
      );
      await user.click(screen.getByRole('button', { name: 'ABANDON' }));
      await waitFor(() => {
        expect(mockAbandonCampaign).toHaveBeenCalledWith('camp-1');
      });
    });
  });

  describe('compromised status', () => {
    it('renders ABANDON button and guidance message', () => {
      renderWithProviders(<CampaignControls {...baseProps} status="compromised" />);
      expect(screen.getByRole('button', { name: 'ABANDON' })).toBeInTheDocument();
      expect(screen.getByText(/TACTICAL OVERRIDE/)).toBeInTheDocument();
    });

    it('does not render GREEN LIGHT or MISSION ACCOMPLISHED', () => {
      renderWithProviders(<CampaignControls {...baseProps} status="compromised" />);
      expect(screen.queryByRole('button', { name: 'GREEN LIGHT' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'MISSION ACCOMPLISHED' })).not.toBeInTheDocument();
    });
  });

  describe('accomplished status', () => {
    it('renders no buttons', () => {
      renderWithProviders(<CampaignControls {...baseProps} status="accomplished" />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  describe('abandoned status', () => {
    it('renders no buttons', () => {
      renderWithProviders(<CampaignControls {...baseProps} status="abandoned" />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  describe('confirmation cancellation', () => {
    it('does not call launchCampaign when confirm is cancelled', async () => {
      confirmResult = -1;
      const { user } = renderWithProviders(
        <CampaignControls {...baseProps} status="planning" />,
      );
      await user.click(screen.getByRole('button', { name: 'GREEN LIGHT' }));
      await waitFor(() => {
        expect(mockLaunchCampaign).not.toHaveBeenCalled();
      });
    });

    it('does not call abandonCampaign when confirm is cancelled', async () => {
      confirmResult = -1;
      const { user } = renderWithProviders(
        <CampaignControls {...baseProps} status="active" />,
      );
      await user.click(screen.getByRole('button', { name: 'ABANDON' }));
      await waitFor(() => {
        expect(mockAbandonCampaign).not.toHaveBeenCalled();
      });
    });
  });

  describe('error handling', () => {
    it('displays error message when action fails', async () => {
      mockCompleteCampaign.mockRejectedValueOnce(new Error('Network error'));
      const { user } = renderWithProviders(
        <CampaignControls {...baseProps} status="active" />,
      );
      await user.click(screen.getByRole('button', { name: 'MISSION ACCOMPLISHED' }));
      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });
  });
});
