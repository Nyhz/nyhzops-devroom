import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { TacInput, TacTextarea } from '../tac-input';

describe('TacInput', () => {
  it('renders an input element', () => {
    renderWithProviders(<TacInput placeholder="Enter codename" />);
    expect(screen.getByPlaceholderText('Enter codename')).toBeInTheDocument();
  });

  it('accepts and displays a value', () => {
    renderWithProviders(<TacInput defaultValue="ALPHA" />);
    expect(screen.getByDisplayValue('ALPHA')).toBeInTheDocument();
  });

  it('handles user typing', async () => {
    const { user } = renderWithProviders(<TacInput placeholder="Type here" />);
    const input = screen.getByPlaceholderText('Type here');

    await user.type(input, 'BRAVO');
    expect(input).toHaveValue('BRAVO');
  });

  it('respects disabled state', () => {
    renderWithProviders(<TacInput disabled placeholder="Locked" />);
    expect(screen.getByPlaceholderText('Locked')).toBeDisabled();
  });

  it('merges custom className', () => {
    renderWithProviders(<TacInput className="mt-2" placeholder="test" />);
    const input = screen.getByPlaceholderText('test');
    expect(input).toHaveClass('mt-2');
    expect(input).toHaveClass('font-tactical');
  });

  it('passes through HTML attributes', () => {
    renderWithProviders(<TacInput type="password" placeholder="secret" />);
    expect(screen.getByPlaceholderText('secret')).toHaveAttribute('type', 'password');
  });
});

describe('TacTextarea', () => {
  it('renders a textarea element', () => {
    renderWithProviders(<TacTextarea placeholder="Enter briefing" />);
    expect(screen.getByPlaceholderText('Enter briefing')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter briefing').tagName).toBe('TEXTAREA');
  });

  it('handles user typing', async () => {
    const { user } = renderWithProviders(<TacTextarea placeholder="Brief" />);
    const textarea = screen.getByPlaceholderText('Brief');

    await user.type(textarea, 'Mission details');
    expect(textarea).toHaveValue('Mission details');
  });

  it('respects disabled state', () => {
    renderWithProviders(<TacTextarea disabled placeholder="Locked" />);
    expect(screen.getByPlaceholderText('Locked')).toBeDisabled();
  });

  it('merges custom className', () => {
    renderWithProviders(<TacTextarea className="h-64" placeholder="test" />);
    const textarea = screen.getByPlaceholderText('test');
    expect(textarea).toHaveClass('h-64');
    expect(textarea).toHaveClass('font-tactical');
  });
});
