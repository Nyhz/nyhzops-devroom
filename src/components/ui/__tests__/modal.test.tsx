import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import {
  TacModal,
  TacModalTrigger,
  TacModalContent,
  TacModalHeader,
  TacModalTitle,
  TacModalDescription,
  TacModalFooter,
  TacModalClose,
} from '../modal';
import { TacButton } from '../tac-button';

function TestModal({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <TacModal defaultOpen={defaultOpen}>
      <TacModalTrigger render={<TacButton />}>Open Modal</TacModalTrigger>
      <TacModalContent>
        <TacModalHeader>
          <TacModalTitle>Mission Briefing</TacModalTitle>
          <TacModalDescription>Review the operation details</TacModalDescription>
        </TacModalHeader>
        <div>Modal body content</div>
        <TacModalFooter>
          <TacModalClose render={<TacButton variant="ghost" />}>Dismiss</TacModalClose>
          <TacButton>Confirm</TacButton>
        </TacModalFooter>
      </TacModalContent>
    </TacModal>
  );
}

describe('TacModal', () => {
  it('renders the trigger button', () => {
    renderWithProviders(<TestModal />);
    expect(screen.getByRole('button', { name: 'Open Modal' })).toBeInTheDocument();
  });

  it('does not show content when closed', () => {
    renderWithProviders(<TestModal />);
    expect(screen.queryByText('Mission Briefing')).not.toBeInTheDocument();
  });

  it('opens when trigger is clicked', async () => {
    const { user } = renderWithProviders(<TestModal />);
    await user.click(screen.getByRole('button', { name: 'Open Modal' }));

    await waitFor(() => {
      expect(screen.getByText('Mission Briefing')).toBeInTheDocument();
    });
    expect(screen.getByText('Review the operation details')).toBeInTheDocument();
    expect(screen.getByText('Modal body content')).toBeInTheDocument();
  });

  it('renders when defaultOpen is true', async () => {
    renderWithProviders(<TestModal defaultOpen />);
    await waitFor(() => {
      expect(screen.getByText('Mission Briefing')).toBeInTheDocument();
    });
  });

  it('closes when close button is clicked', async () => {
    const { user } = renderWithProviders(<TestModal defaultOpen />);
    await waitFor(() => {
      expect(screen.getByText('Mission Briefing')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => {
      expect(screen.queryByText('Mission Briefing')).not.toBeInTheDocument();
    });
  });

  it('closes on Escape key', async () => {
    const { user } = renderWithProviders(<TestModal defaultOpen />);
    await waitFor(() => {
      expect(screen.getByText('Mission Briefing')).toBeInTheDocument();
    });

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByText('Mission Briefing')).not.toBeInTheDocument();
    });
  });

  it('renders footer content', async () => {
    renderWithProviders(<TestModal defaultOpen />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    });
  });

  it('applies tactical styling to content', async () => {
    renderWithProviders(<TestModal defaultOpen />);
    await waitFor(() => {
      const content = screen.getByText('Mission Briefing').closest('[data-slot="dialog-content"]');
      expect(content).toHaveClass('bg-dr-surface');
    });
  });
});
