import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { BootstrapComms } from '../bootstrap-comms';

// Mock useMissionComms hook
const mockMissionComms = {
  logs: [] as Array<{ id: string; missionId: string; timestamp: number; type: string; content: string }>,
  status: 'queued' as string | null,
  debrief: null as string | null,
  tokens: null,
};

vi.mock('@/hooks/use-mission-comms', () => ({
  useMissionComms: () => mockMissionComms,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockMissionComms.logs = [];
  mockMissionComms.status = 'queued';
  mockMissionComms.debrief = null;
  mockMissionComms.tokens = null;
});

describe('BootstrapComms', () => {
  it('renders codename with INITIALIZING label', () => {
    renderWithProviders(
      <BootstrapComms missionId="m-1" codename="ALPHA" />,
    );
    expect(screen.getByText('ALPHA — INITIALIZING')).toBeInTheDocument();
  });

  it('renders breadcrumb text', () => {
    renderWithProviders(
      <BootstrapComms missionId="m-1" codename="ALPHA" />,
    );
    expect(screen.getByText('Battlefields //')).toBeInTheDocument();
  });

  it('renders generating intel message', () => {
    renderWithProviders(
      <BootstrapComms missionId="m-1" codename="ALPHA" />,
    );
    expect(
      screen.getByText('Generating battlefield intel...'),
    ).toBeInTheDocument();
  });

  it('renders COMMS header', () => {
    renderWithProviders(
      <BootstrapComms missionId="m-1" codename="ALPHA" />,
    );
    expect(screen.getByText('COMMS')).toBeInTheDocument();
  });

  it('renders logs in terminal', () => {
    mockMissionComms.logs = [
      { id: '1', missionId: 'm-1', timestamp: 100, type: 'log', content: 'Scanning repo...' },
      { id: '2', missionId: 'm-1', timestamp: 200, type: 'log', content: 'Generating docs...' },
    ];

    renderWithProviders(
      <BootstrapComms missionId="m-1" codename="BRAVO" />,
    );
    // Terminal may merge consecutive logs — check combined text
    expect(screen.getByText(/Scanning repo\.\.\./)).toBeInTheDocument();
    expect(screen.getByText(/Generating docs\.\.\./)).toBeInTheDocument();
  });

  it('renders with empty logs', () => {
    mockMissionComms.logs = [];

    renderWithProviders(
      <BootstrapComms missionId="m-1" codename="CHARLIE" />,
    );
    // Should render without errors
    expect(screen.getByText('CHARLIE — INITIALIZING')).toBeInTheDocument();
  });
});
