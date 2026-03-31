// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { TacButton } from '../tac-button';

describe('TacButton', () => {
  it('renders with correct text', () => {
    renderWithProviders(<TacButton>DEPLOY</TacButton>);
    expect(screen.getByRole('button', { name: 'DEPLOY' })).toBeInTheDocument();
  });

  it('fires click handler', async () => {
    const onClick = vi.fn();
    const { user } = renderWithProviders(
      <TacButton onClick={onClick}>EXECUTE</TacButton>,
    );

    await user.click(screen.getByRole('button', { name: 'EXECUTE' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('applies variant styles', () => {
    renderWithProviders(<TacButton variant="danger">ABORT</TacButton>);
    const button = screen.getByRole('button', { name: 'ABORT' });
    expect(button).toHaveClass('border-dr-red');
  });

  it('respects disabled state', async () => {
    const onClick = vi.fn();
    const { user } = renderWithProviders(
      <TacButton disabled onClick={onClick}>LOCKED</TacButton>,
    );

    const button = screen.getByRole('button', { name: 'LOCKED' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
