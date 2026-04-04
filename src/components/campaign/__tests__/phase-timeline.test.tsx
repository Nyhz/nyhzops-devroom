import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { PhaseTimeline } from '../phase-timeline';

// Mock the Markdown component to avoid react-markdown jsdom issues
vi.mock('@/components/ui/markdown', () => ({
  Markdown: ({ content, className }: { content: string; className?: string }) => (
    <div className={className} data-testid="markdown">{content}</div>
  ),
}));

function makePhase(overrides: Partial<Parameters<typeof PhaseTimeline>[0]['phases'][0]> = {}) {
  return {
    id: 'phase-1',
    phaseNumber: 1,
    name: 'Recon',
    objective: null,
    status: null,
    debrief: null,
    totalTokens: null,
    durationMs: null,
    missions: [],
    ...overrides,
  };
}

function makeMission(overrides: Partial<Parameters<typeof PhaseTimeline>[0]['phases'][0]['missions'][0]> = {}) {
  return {
    id: 'mission-1',
    title: 'Scout Perimeter',
    status: null,
    assetCodename: null,
    priority: null,
    durationMs: null,
    costInput: null,
    costOutput: null,
    ...overrides,
  };
}

describe('PhaseTimeline', () => {
  it('renders empty state when no phases', () => {
    renderWithProviders(<PhaseTimeline phases={[]} />);
    expect(screen.getByText('No phases in this campaign')).toBeInTheDocument();
  });

  it('renders phase number and name', () => {
    renderWithProviders(
      <PhaseTimeline phases={[makePhase({ phaseNumber: 2, name: 'Infiltration' })]} />,
    );
    expect(screen.getByText('PHASE 2')).toBeInTheDocument();
    expect(screen.getByText('Infiltration')).toBeInTheDocument();
  });

  it('renders phase status badge when provided', () => {
    renderWithProviders(
      <PhaseTimeline phases={[makePhase({ status: 'active' })]} />,
    );
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
  });

  it('does not render status badge when status is null', () => {
    renderWithProviders(
      <PhaseTimeline phases={[makePhase({ status: null })]} />,
    );
    expect(screen.queryByText('ACTIVE')).not.toBeInTheDocument();
  });

  it('renders phase objective when provided', () => {
    renderWithProviders(
      <PhaseTimeline phases={[makePhase({ objective: 'Gather intel' })]} />,
    );
    expect(screen.getByText('Gather intel')).toBeInTheDocument();
  });

  it('does not render objective when null', () => {
    renderWithProviders(
      <PhaseTimeline phases={[makePhase({ objective: null })]} />,
    );
    expect(screen.queryByText('Gather intel')).not.toBeInTheDocument();
  });

  it('renders duration when provided', () => {
    renderWithProviders(
      <PhaseTimeline phases={[makePhase({ durationMs: 65000 })]} />,
    );
    expect(screen.getByText('1m 5s')).toBeInTheDocument();
  });

  it('renders total tokens when provided', () => {
    renderWithProviders(
      <PhaseTimeline phases={[makePhase({ totalTokens: 5000 })]} />,
    );
    expect(screen.getByText('5.0K tokens')).toBeInTheDocument();
  });

  it('renders "No missions in this phase" when phase has no missions', () => {
    renderWithProviders(
      <PhaseTimeline phases={[makePhase({ missions: [] })]} />,
    );
    expect(screen.getByText('No missions in this phase')).toBeInTheDocument();
  });

  it('renders mission cards', () => {
    renderWithProviders(
      <PhaseTimeline
        phases={[
          makePhase({
            missions: [
              makeMission({ title: 'Scout Perimeter' }),
              makeMission({ id: 'mission-2', title: 'Plant Sensors' }),
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText('Scout Perimeter')).toBeInTheDocument();
    expect(screen.getByText('Plant Sensors')).toBeInTheDocument();
  });

  it('wraps mission cards in links when battlefieldId is provided', () => {
    renderWithProviders(
      <PhaseTimeline
        phases={[
          makePhase({
            missions: [makeMission({ id: 'mis-abc' })],
          }),
        ]}
        battlefieldId="bf-123"
      />,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/battlefields/bf-123/missions/mis-abc');
  });

  it('does not wrap mission cards in links when no battlefieldId', () => {
    renderWithProviders(
      <PhaseTimeline
        phases={[makePhase({ missions: [makeMission()] })]}
      />,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders debrief as collapsible details', () => {
    renderWithProviders(
      <PhaseTimeline
        phases={[makePhase({ debrief: 'Phase complete' })]}
      />,
    );
    expect(screen.getByText('DEBRIEF')).toBeInTheDocument();
    expect(screen.getByTestId('markdown')).toHaveTextContent('Phase complete');
  });

  it('does not render debrief when null', () => {
    renderWithProviders(
      <PhaseTimeline phases={[makePhase({ debrief: null })]} />,
    );
    expect(screen.queryByText('DEBRIEF')).not.toBeInTheDocument();
  });

  it('renders multiple phases in order', () => {
    renderWithProviders(
      <PhaseTimeline
        phases={[
          makePhase({ id: 'p1', phaseNumber: 1, name: 'Alpha' }),
          makePhase({ id: 'p2', phaseNumber: 2, name: 'Bravo' }),
          makePhase({ id: 'p3', phaseNumber: 3, name: 'Charlie' }),
        ]}
      />,
    );
    const phases = screen.getAllByText(/^PHASE \d/);
    expect(phases).toHaveLength(3);
    expect(phases[0]).toHaveTextContent('PHASE 1');
    expect(phases[1]).toHaveTextContent('PHASE 2');
    expect(phases[2]).toHaveTextContent('PHASE 3');
  });

  it('renders completed phase with green status', () => {
    renderWithProviders(
      <PhaseTimeline phases={[makePhase({ status: 'secured' })]} />,
    );
    expect(screen.getByText('SECURED')).toBeInTheDocument();
  });

  it('renders compromised phase with red status', () => {
    renderWithProviders(
      <PhaseTimeline phases={[makePhase({ status: 'compromised' })]} />,
    );
    expect(screen.getByText('COMPROMISED')).toBeInTheDocument();
  });
});
