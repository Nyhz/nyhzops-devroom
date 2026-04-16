import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { CampaignMissionCard } from '../mission-card';

// Mock DebriefPanel to avoid deep dependency chain in unit tests
vi.mock('@/components/mission/debrief-panel', () => ({
  DebriefPanel: ({ debriefText }: { debriefText: string | null }) => (
    <div data-testid="debrief-panel">{debriefText}</div>
  ),
}));

describe('CampaignMissionCard', () => {
  const baseProps = {
    title: 'Recon Alpha',
    assetCodename: null,
    status: null,
    priority: null,
    durationMs: null,
    costInput: null,
    costOutput: null,
  };

  it('renders mission title', () => {
    renderWithProviders(<CampaignMissionCard {...baseProps} />);
    expect(screen.getByText('Recon Alpha')).toBeInTheDocument();
  });

  it('renders asset codename when provided', () => {
    renderWithProviders(
      <CampaignMissionCard {...baseProps} assetCodename="PHANTOM" />,
    );
    expect(screen.getByText('PHANTOM')).toBeInTheDocument();
  });

  it('does not render asset codename when null', () => {
    renderWithProviders(<CampaignMissionCard {...baseProps} />);
    expect(screen.queryByText('PHANTOM')).not.toBeInTheDocument();
  });

  it('renders status badge when provided', () => {
    renderWithProviders(
      <CampaignMissionCard {...baseProps} status="accomplished" />,
    );
    expect(screen.getByText('ACCOMPLISHED')).toBeInTheDocument();
  });

  it('does not render status badge when null', () => {
    const { container } = renderWithProviders(
      <CampaignMissionCard {...baseProps} />,
    );
    // No TacBadge rendered
    expect(container.querySelector('.font-tactical.text-xs.tracking-wider')).toBeNull();
  });

  it('renders priority dot with correct color for critical', () => {
    const { container } = renderWithProviders(
      <CampaignMissionCard {...baseProps} priority="critical" />,
    );
    const dot = container.querySelector('[title="Priority: critical"]');
    expect(dot).toBeInTheDocument();
    expect(dot).toHaveClass('bg-dr-red');
  });

  it('renders priority dot with correct color for high', () => {
    const { container } = renderWithProviders(
      <CampaignMissionCard {...baseProps} priority="high" />,
    );
    const dot = container.querySelector('[title="Priority: high"]');
    expect(dot).toHaveClass('bg-dr-amber');
  });

  it('defaults to routine priority when null', () => {
    const { container } = renderWithProviders(
      <CampaignMissionCard {...baseProps} />,
    );
    const dot = container.querySelector('[title="Priority: routine"]');
    expect(dot).toBeInTheDocument();
    expect(dot).toHaveClass('bg-dr-muted');
  });

  it('renders duration when provided', () => {
    renderWithProviders(
      <CampaignMissionCard {...baseProps} durationMs={125000} />,
    );
    expect(screen.getByText('2m 5s')).toBeInTheDocument();
  });

  it('renders token count when costInput and costOutput provided', () => {
    renderWithProviders(
      <CampaignMissionCard
        {...baseProps}
        costInput={1500}
        costOutput={500}
      />,
    );
    expect(screen.getByText('2.0K tokens')).toBeInTheDocument();
  });

  it('does not render metrics when no duration or cost', () => {
    const { container } = renderWithProviders(
      <CampaignMissionCard {...baseProps} />,
    );
    expect(container.querySelector('.font-data')).toBeNull();
  });

  it('accepts className prop', () => {
    const { container } = renderWithProviders(
      <CampaignMissionCard {...baseProps} className="custom-class" />,
    );
    expect(container.firstChild).toHaveClass('custom-class');
  });

  describe('structured debrief', () => {
    it('shows DEBRIEF toggle when debriefText is provided', () => {
      renderWithProviders(
        <CampaignMissionCard {...baseProps} debriefText="Operation was a success." />,
      );
      expect(screen.getByText(/DEBRIEF/)).toBeInTheDocument();
    });

    it('shows DEBRIEF toggle when debriefStructured is provided', () => {
      const structured = JSON.stringify({
        summary: 'Done',
        commits: [],
        files_touched: [],
        confidence: 'high',
        open_questions: [],
      });
      renderWithProviders(
        <CampaignMissionCard {...baseProps} debriefStructured={structured} />,
      );
      expect(screen.getByText(/DEBRIEF/)).toBeInTheDocument();
    });

    it('does not show DEBRIEF toggle when no debrief data', () => {
      renderWithProviders(<CampaignMissionCard {...baseProps} />);
      expect(screen.queryByText(/DEBRIEF/)).not.toBeInTheDocument();
    });

    it('expands debrief panel on toggle click', async () => {
      const { user } = renderWithProviders(
        <CampaignMissionCard {...baseProps} debriefText="Mission complete." />,
      );
      expect(screen.queryByTestId('debrief-panel')).not.toBeInTheDocument();
      await user.click(screen.getByText(/DEBRIEF/));
      expect(screen.getByTestId('debrief-panel')).toBeInTheDocument();
    });

    it('collapses debrief panel on second toggle click', async () => {
      const { user } = renderWithProviders(
        <CampaignMissionCard {...baseProps} debriefText="Mission complete." />,
      );
      await user.click(screen.getByText(/HIDE DEBRIEF|DEBRIEF/));
      expect(screen.getByTestId('debrief-panel')).toBeInTheDocument();
      await user.click(screen.getByText(/HIDE DEBRIEF/));
      expect(screen.queryByTestId('debrief-panel')).not.toBeInTheDocument();
    });
  });
});
