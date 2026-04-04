import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import {
  TacSelect,
  TacSelectTrigger,
  TacSelectContent,
  TacSelectItem,
  TacSelectValue,
} from '../tac-select';

function TestSelect({
  defaultValue,
  onValueChange,
}: {
  defaultValue?: string;
  onValueChange?: (val: string | null) => void;
}) {
  return (
    <TacSelect defaultValue={defaultValue} onValueChange={onValueChange}>
      <TacSelectTrigger aria-label="Select asset">
        <TacSelectValue placeholder="Select an asset" />
      </TacSelectTrigger>
      <TacSelectContent>
        <TacSelectItem value="alpha">ALPHA</TacSelectItem>
        <TacSelectItem value="bravo">BRAVO</TacSelectItem>
        <TacSelectItem value="charlie">CHARLIE</TacSelectItem>
      </TacSelectContent>
    </TacSelect>
  );
}

describe('TacSelect', () => {
  it('renders the trigger with placeholder', () => {
    renderWithProviders(<TestSelect />);
    expect(screen.getByText('Select an asset')).toBeInTheDocument();
  });

  it('renders with a default value', () => {
    renderWithProviders(<TestSelect defaultValue="alpha" />);
    // base-ui renders the raw value string in the trigger, not the item children
    expect(screen.getByText('alpha')).toBeInTheDocument();
  });

  it('applies tactical styling to trigger', () => {
    renderWithProviders(<TestSelect />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveClass('font-tactical');
  });

  it('opens dropdown when trigger is clicked', async () => {
    const { user } = renderWithProviders(<TestSelect />);
    await user.click(screen.getByRole('combobox'));

    await waitFor(() => {
      expect(screen.getByText('BRAVO')).toBeInTheDocument();
      expect(screen.getByText('CHARLIE')).toBeInTheDocument();
    });
  });

  it('shows all items when dropdown opens', async () => {
    const { user } = renderWithProviders(<TestSelect />);

    const trigger = screen.getByRole('combobox');
    trigger.focus();
    await user.keyboard('{ArrowDown}');

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    expect(screen.getByText('ALPHA')).toBeInTheDocument();
    expect(screen.getByText('BRAVO')).toBeInTheDocument();
    expect(screen.getByText('CHARLIE')).toBeInTheDocument();
  });
});
