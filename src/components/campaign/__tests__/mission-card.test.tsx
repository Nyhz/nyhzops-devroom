import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { CampaignMissionCard } from '../mission-card';

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

  it('defaults to normal priority when null', () => {
    const { container } = renderWithProviders(
      <CampaignMissionCard {...baseProps} />,
    );
    const dot = container.querySelector('[title="Priority: normal"]');
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
});
