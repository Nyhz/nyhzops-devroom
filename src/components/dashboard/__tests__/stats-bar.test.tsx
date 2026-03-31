import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { StatsBar } from '../stats-bar';

const defaultProps = {
  inCombat: 3,
  accomplished: 12,
  compromised: 2,
  standby: 5,
  cacheHitPercent: '87%',
};

describe('StatsBar', () => {
  it('renders all stat values', () => {
    renderWithProviders(<StatsBar {...defaultProps} />);

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('87%')).toBeInTheDocument();
  });

  it('renders all stat labels', () => {
    renderWithProviders(<StatsBar {...defaultProps} />);

    expect(screen.getByText('IN COMBAT')).toBeInTheDocument();
    expect(screen.getByText('ACCOMPLISHED')).toBeInTheDocument();
    expect(screen.getByText('COMPROMISED')).toBeInTheDocument();
    expect(screen.getByText('STANDBY')).toBeInTheDocument();
    expect(screen.getByText('CACHE HIT')).toBeInTheDocument();
  });

  it('renders zero values correctly', () => {
    renderWithProviders(
      <StatsBar
        inCombat={0}
        accomplished={0}
        compromised={0}
        standby={0}
        cacheHitPercent="0%"
      />,
    );

    const zeros = screen.getAllByText('0');
    expect(zeros).toHaveLength(4);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('renders large numbers', () => {
    renderWithProviders(
      <StatsBar
        inCombat={999}
        accomplished={1500}
        compromised={42}
        standby={300}
        cacheHitPercent="99.9%"
      />,
    );

    expect(screen.getByText('999')).toBeInTheDocument();
    expect(screen.getByText('1500')).toBeInTheDocument();
    expect(screen.getByText('99.9%')).toBeInTheDocument();
  });
});
