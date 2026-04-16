import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { Terminal } from '../terminal';

const makeLog = (
  content: string,
  type: 'comms' | 'sitrep' | 'alert' = 'comms',
  actor?: 'CONTROL' | 'OPERATIVE' | 'OVERSEER' | 'COMMANDER',
  timestamp = 1_000,
) => ({ timestamp, type, content, actor });

describe('Terminal', () => {
  it('renders log content', () => {
    renderWithProviders(
      <Terminal logs={[makeLog('Hello world')]} />,
    );
    expect(screen.getByText(/Hello world/)).toBeInTheDocument();
  });

  it('renders actor label for comms entry with actor', () => {
    renderWithProviders(
      <Terminal logs={[makeLog('Checking pipeline', 'comms', 'CONTROL')]} />,
    );
    const label = screen.getByText('[CONTROL]');
    expect(label).toBeInTheDocument();
    expect(label).toHaveAttribute('data-actor', 'CONTROL');
  });

  it('applies dim color class to CONTROL actor label', () => {
    renderWithProviders(
      <Terminal logs={[makeLog('Ping', 'comms', 'CONTROL')]} />,
    );
    const label = screen.getByText('[CONTROL]');
    expect(label).toHaveClass('text-dr-dim');
  });

  it('applies green color class to OPERATIVE actor label', () => {
    renderWithProviders(
      <Terminal logs={[makeLog('Running tests', 'comms', 'OPERATIVE')]} />,
    );
    const label = screen.getByText('[OPERATIVE]');
    expect(label).toHaveClass('text-dr-green');
  });

  it('applies teal color class to OVERSEER actor label', () => {
    renderWithProviders(
      <Terminal logs={[makeLog('Reviewing debrief', 'comms', 'OVERSEER')]} />,
    );
    const label = screen.getByText('[OVERSEER]');
    expect(label).toHaveClass('text-dr-teal');
  });

  it('applies amber color class to COMMANDER actor label', () => {
    renderWithProviders(
      <Terminal logs={[makeLog('Override issued', 'comms', 'COMMANDER')]} />,
    );
    const label = screen.getByText('[COMMANDER]');
    expect(label).toHaveClass('text-dr-amber');
  });

  it('does not render an actor label when actor is absent', () => {
    renderWithProviders(
      <Terminal logs={[makeLog('No actor here')]} />,
    );
    expect(screen.queryByText(/\[CONTROL\]/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\[OPERATIVE\]/)).not.toBeInTheDocument();
  });

  it('rendered content contains no raw ANSI escape codes', () => {
    renderWithProviders(
      <Terminal
        logs={[
          makeLog('Status ok', 'comms', 'CONTROL'),
          makeLog('Running', 'comms', 'OPERATIVE'),
        ]}
      />,
    );
    // The full rendered text must not include ANSI ESC sequences
    expect(document.body.textContent).not.toMatch(/\x1b\[/);
  });

  it('collapses repeated identical tool calls', () => {
    const toolLog = makeLog('Tool: Bash', 'comms');
    renderWithProviders(
      <Terminal logs={[toolLog, { ...toolLog, timestamp: 2000 }, { ...toolLog, timestamp: 3000 }]} />,
    );
    // Should show count indicator
    expect(screen.getByText('(3)')).toBeInTheDocument();
  });

  it('does not coalesce comms from different actors', () => {
    renderWithProviders(
      <Terminal
        logs={[
          makeLog('First message', 'comms', 'CONTROL', 1000),
          makeLog('Second message', 'comms', 'OPERATIVE', 2000),
        ]}
      />,
    );
    // Both messages should appear as separate entries
    expect(screen.getByText('[CONTROL]')).toBeInTheDocument();
    expect(screen.getByText('[OPERATIVE]')).toBeInTheDocument();
    expect(screen.getByText(/First message/)).toBeInTheDocument();
    expect(screen.getByText(/Second message/)).toBeInTheDocument();
  });
});
