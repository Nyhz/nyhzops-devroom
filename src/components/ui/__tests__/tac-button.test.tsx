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

  it('applies primary variant styles by default', () => {
    renderWithProviders(<TacButton>GO</TacButton>);
    const button = screen.getByRole('button', { name: 'GO' });
    expect(button).toHaveClass('border-dr-amber');
  });

  it('applies danger variant styles', () => {
    renderWithProviders(<TacButton variant="danger">ABORT</TacButton>);
    const button = screen.getByRole('button', { name: 'ABORT' });
    expect(button).toHaveClass('border-dr-red');
  });

  it('applies success variant styles', () => {
    renderWithProviders(<TacButton variant="success">CONFIRM</TacButton>);
    const button = screen.getByRole('button', { name: 'CONFIRM' });
    expect(button).toHaveClass('border-dr-green');
  });

  it('applies ghost variant styles', () => {
    renderWithProviders(<TacButton variant="ghost">CANCEL</TacButton>);
    const button = screen.getByRole('button', { name: 'CANCEL' });
    expect(button).toHaveClass('border-dr-border');
  });

  it('applies size styles', () => {
    renderWithProviders(<TacButton size="sm">SMALL</TacButton>);
    expect(screen.getByRole('button', { name: 'SMALL' })).toHaveClass('px-4', 'py-2', 'text-sm');
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

  it('merges custom className', () => {
    renderWithProviders(<TacButton className="mt-4">STYLED</TacButton>);
    const button = screen.getByRole('button', { name: 'STYLED' });
    expect(button).toHaveClass('mt-4');
    expect(button).toHaveClass('font-tactical');
  });
});
