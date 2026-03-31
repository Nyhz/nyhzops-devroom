// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test/render';
import { TacCard } from '../tac-card';

describe('TacCard', () => {
  it('renders children', () => {
    renderWithProviders(<TacCard>Mission briefing content</TacCard>);
    expect(screen.getByText('Mission briefing content')).toBeInTheDocument();
  });

  it('renders nested elements', () => {
    renderWithProviders(
      <TacCard>
        <h2>Title</h2>
        <p>Description</p>
      </TacCard>,
    );
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
  });

  it('applies green status border', () => {
    const { container } = renderWithProviders(
      <TacCard status="green">Content</TacCard>,
    );
    expect(container.firstChild).toHaveClass('border-l-dr-green');
  });

  it('applies amber status border', () => {
    const { container } = renderWithProviders(
      <TacCard status="amber">Content</TacCard>,
    );
    expect(container.firstChild).toHaveClass('border-l-dr-amber');
  });

  it('applies red status border', () => {
    const { container } = renderWithProviders(
      <TacCard status="red">Content</TacCard>,
    );
    expect(container.firstChild).toHaveClass('border-l-dr-red');
  });

  it('applies blue status border', () => {
    const { container } = renderWithProviders(
      <TacCard status="blue">Content</TacCard>,
    );
    expect(container.firstChild).toHaveClass('border-l-dr-blue');
  });

  it('applies no extra border for dim status', () => {
    const { container } = renderWithProviders(
      <TacCard status="dim">Content</TacCard>,
    );
    expect(container.firstChild).not.toHaveClass('border-l-2');
  });

  it('renders without status (no border accent)', () => {
    const { container } = renderWithProviders(
      <TacCard>Content</TacCard>,
    );
    expect(container.firstChild).toHaveClass('bg-dr-surface');
    expect(container.firstChild).not.toHaveClass('border-l-2');
  });

  it('merges custom className', () => {
    const { container } = renderWithProviders(
      <TacCard className="mt-8">Content</TacCard>,
    );
    expect(container.firstChild).toHaveClass('mt-8');
    expect(container.firstChild).toHaveClass('bg-dr-surface');
  });
});
