import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { InlineErrorPanel } from '../inline-error-panel';

describe('InlineErrorPanel', () => {
  const baseProps = {
    title: 'PHASE DEBRIEF FAILURE',
    detail: 'Unable to generate debrief for phase.',
    actions: [],
  };

  it('renders title and detail text', () => {
    renderWithProviders(<InlineErrorPanel {...baseProps} />);
    expect(screen.getByText('PHASE DEBRIEF FAILURE')).toBeInTheDocument();
    expect(screen.getByText('Unable to generate debrief for phase.')).toBeInTheDocument();
  });

  it('renders context when provided', () => {
    renderWithProviders(
      <InlineErrorPanel
        {...baseProps}
        context="Phase 2 — Operation Alpha"
      />,
    );
    expect(screen.getByText('Phase 2 — Operation Alpha')).toBeInTheDocument();
  });

  it('does not render context section when context is undefined', () => {
    renderWithProviders(<InlineErrorPanel {...baseProps} />);
    expect(screen.queryByTestId('inline-error-context')).not.toBeInTheDocument();
  });

  it('renders action buttons and calls onClick handlers', async () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    const { user } = renderWithProviders(
      <InlineErrorPanel
        {...baseProps}
        actions={[
          { label: 'RETRY', onClick: onRetry, variant: 'primary' },
          { label: 'DISMISS', onClick: onDismiss, variant: 'secondary' },
        ]}
      />,
    );

    const retryBtn = screen.getByRole('button', { name: 'RETRY' });
    const dismissBtn = screen.getByRole('button', { name: 'DISMISS' });

    expect(retryBtn).toBeInTheDocument();
    expect(dismissBtn).toBeInTheDocument();

    await user.click(retryBtn);
    expect(onRetry).toHaveBeenCalledOnce();

    await user.click(dismissBtn);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('applies danger variant styles to danger action button', () => {
    renderWithProviders(
      <InlineErrorPanel
        {...baseProps}
        actions={[{ label: 'ABORT', onClick: vi.fn(), variant: 'danger' }]}
      />,
    );
    const btn = screen.getByRole('button', { name: 'ABORT' });
    expect(btn).toHaveClass('bg-tac-red/20');
  });

  it('applies primary variant styles to primary action button', () => {
    renderWithProviders(
      <InlineErrorPanel
        {...baseProps}
        actions={[{ label: 'RETRY', onClick: vi.fn(), variant: 'primary' }]}
      />,
    );
    const btn = screen.getByRole('button', { name: 'RETRY' });
    expect(btn).toHaveClass('bg-tac-green/20');
  });

  it('applies secondary variant styles to secondary action button', () => {
    renderWithProviders(
      <InlineErrorPanel
        {...baseProps}
        actions={[{ label: 'DISMISS', onClick: vi.fn(), variant: 'secondary' }]}
      />,
    );
    const btn = screen.getByRole('button', { name: 'DISMISS' });
    expect(btn).toHaveClass('bg-tac-muted/20');
  });

  it('merges custom className on container', () => {
    renderWithProviders(<InlineErrorPanel {...baseProps} className="mt-4" />);
    // The title is inside the container — check the parent structure
    const title = screen.getByText('PHASE DEBRIEF FAILURE');
    expect(title.closest('[class*="mt-4"]')).toBeInTheDocument();
  });
});
