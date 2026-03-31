// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { TacTextareaWithImages } from '../tac-textarea-with-images';

function ControlledTextarea({ initialValue = '' }: { initialValue?: string }) {
  const [value, setValue] = __import_react.useState(initialValue);
  return <TacTextareaWithImages value={value} onChange={setValue} placeholder="Enter briefing" />;
}

// Need React for the controlled wrapper
import * as __import_react from 'react';

describe('TacTextareaWithImages', () => {
  it('renders a textarea with placeholder', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <TacTextareaWithImages value="" onChange={onChange} placeholder="Enter briefing" />,
    );
    expect(screen.getByPlaceholderText('Enter briefing')).toBeInTheDocument();
  });

  it('displays the current value', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <TacTextareaWithImages value="Mission details" onChange={onChange} />,
    );
    expect(screen.getByDisplayValue('Mission details')).toBeInTheDocument();
  });

  it('calls onChange when text is typed', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <TacTextareaWithImages value="" onChange={onChange} placeholder="Type" />,
    );

    await user.type(screen.getByPlaceholderText('Type'), 'A');
    expect(onChange).toHaveBeenCalled();
  });

  it('shows paste/drop hint text', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <TacTextareaWithImages value="" onChange={onChange} />,
    );
    expect(screen.getByText('Paste or drop images')).toBeInTheDocument();
  });

  it('respects disabled state', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <TacTextareaWithImages value="" onChange={onChange} disabled placeholder="Locked" />,
    );
    expect(screen.getByPlaceholderText('Locked')).toBeDisabled();
  });

  it('merges custom className', () => {
    const onChange = vi.fn();
    const { container } = renderWithProviders(
      <TacTextareaWithImages value="" onChange={onChange} className="h-96" />,
    );
    const textarea = container.querySelector('textarea');
    expect(textarea).toHaveClass('h-96');
  });

  it('handles controlled value updates', () => {
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(
      <TacTextareaWithImages value="first" onChange={onChange} />,
    );
    expect(screen.getByDisplayValue('first')).toBeInTheDocument();

    rerender(<TacTextareaWithImages value="second" onChange={onChange} />);
    expect(screen.getByDisplayValue('second')).toBeInTheDocument();
  });
});
