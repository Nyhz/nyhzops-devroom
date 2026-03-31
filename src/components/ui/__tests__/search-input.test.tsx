import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { SearchInput } from '../search-input';

describe('SearchInput', () => {
  it('renders an input with placeholder', () => {
    renderWithProviders(<SearchInput placeholder="Search missions..." />);
    expect(screen.getByPlaceholderText('Search missions...')).toBeInTheDocument();
  });

  it('accepts user input', async () => {
    const { user } = renderWithProviders(<SearchInput placeholder="Search" />);
    const input = screen.getByPlaceholderText('Search');

    await user.type(input, 'recon');
    expect(input).toHaveValue('recon');
  });

  it('calls onChange handler', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <SearchInput placeholder="Search" onChange={onChange} />,
    );

    await user.type(screen.getByPlaceholderText('Search'), 'x');
    expect(onChange).toHaveBeenCalled();
  });

  it('renders a search icon', () => {
    const { container } = renderWithProviders(<SearchInput placeholder="Search" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('renders the input as type text', () => {
    renderWithProviders(<SearchInput placeholder="Search" />);
    expect(screen.getByPlaceholderText('Search')).toHaveAttribute('type', 'text');
  });

  it('merges custom className on wrapper', () => {
    const { container } = renderWithProviders(
      <SearchInput className="w-64" placeholder="Search" />,
    );
    expect(container.firstChild).toHaveClass('w-64');
    expect(container.firstChild).toHaveClass('relative');
  });

  it('supports defaultValue', () => {
    renderWithProviders(<SearchInput defaultValue="preloaded" placeholder="Search" />);
    expect(screen.getByPlaceholderText('Search')).toHaveValue('preloaded');
  });
});
