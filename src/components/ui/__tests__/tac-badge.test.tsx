import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { TacBadge, getStatusColor, getStatusBorderColor } from '../tac-badge';

describe('TacBadge', () => {
  it('renders the status label in uppercase', () => {
    renderWithProviders(<TacBadge status="accomplished" />);
    expect(screen.getByText('ACCOMPLISHED')).toBeInTheDocument();
  });

  it('replaces underscores with spaces in label', () => {
    renderWithProviders(<TacBadge status="in_combat" />);
    expect(screen.getByText('IN COMBAT')).toBeInTheDocument();
  });

  it('applies green color for accomplished status', () => {
    const { container } = renderWithProviders(<TacBadge status="accomplished" />);
    expect(container.firstChild).toHaveClass('text-dr-green');
  });

  it('applies amber color for in_combat status', () => {
    const { container } = renderWithProviders(<TacBadge status="in_combat" />);
    expect(container.firstChild).toHaveClass('text-dr-amber');
  });

  it('applies red color for compromised status', () => {
    const { container } = renderWithProviders(<TacBadge status="compromised" />);
    expect(container.firstChild).toHaveClass('text-dr-red');
  });

  it('applies blue color for queued status', () => {
    const { container } = renderWithProviders(<TacBadge status="queued" />);
    expect(container.firstChild).toHaveClass('text-dr-blue');
  });

  it('applies dim color for standby status', () => {
    const { container } = renderWithProviders(<TacBadge status="standby" />);
    expect(container.firstChild).toHaveClass('text-dr-dim');
  });

  it('defaults to dim for unknown status', () => {
    const { container } = renderWithProviders(<TacBadge status="unknown_status" />);
    expect(container.firstChild).toHaveClass('text-dr-dim');
    expect(screen.getByText('UNKNOWN STATUS')).toBeInTheDocument();
  });

  it('normalizes mixed-case status with spaces', () => {
    const { container } = renderWithProviders(<TacBadge status="In Combat" />);
    expect(container.firstChild).toHaveClass('text-dr-amber');
  });

  it('applies glow styles when glow prop is true', () => {
    const { container } = renderWithProviders(<TacBadge status="accomplished" glow />);
    expect(container.firstChild).toHaveClass('shadow-glow-green');
  });

  it('does not apply glow by default', () => {
    const { container } = renderWithProviders(<TacBadge status="accomplished" />);
    expect(container.firstChild).not.toHaveClass('shadow-glow-green');
  });

  it('merges custom className', () => {
    const { container } = renderWithProviders(<TacBadge status="standby" className="ml-2" />);
    expect(container.firstChild).toHaveClass('ml-2');
    expect(container.firstChild).toHaveClass('font-tactical');
  });

  it('renders bullet indicator', () => {
    const { container } = renderWithProviders(<TacBadge status="active" />);
    const bullet = container.querySelector('[aria-hidden="true"]');
    expect(bullet).toBeInTheDocument();
  });
});

describe('getStatusColor', () => {
  it('maps known statuses to correct colors', () => {
    expect(getStatusColor('accomplished')).toBe('green');
    expect(getStatusColor('in_combat')).toBe('amber');
    expect(getStatusColor('compromised')).toBe('red');
    expect(getStatusColor('queued')).toBe('blue');
    expect(getStatusColor('standby')).toBe('dim');
  });

  it('normalizes case and spaces', () => {
    expect(getStatusColor('IN COMBAT')).toBe('amber');
    expect(getStatusColor('Accomplished')).toBe('green');
  });

  it('returns dim for unknown status', () => {
    expect(getStatusColor('nonexistent')).toBe('dim');
  });
});

describe('getStatusBorderColor', () => {
  it('returns correct border class for status', () => {
    expect(getStatusBorderColor('accomplished')).toBe('border-l-dr-green');
    expect(getStatusBorderColor('compromised')).toBe('border-l-dr-red');
  });

  it('returns dim border for null', () => {
    expect(getStatusBorderColor(null)).toBe('border-l-dr-dim');
  });
});
