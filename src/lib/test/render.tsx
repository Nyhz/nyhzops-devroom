import { render, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';

/**
 * Renders a component with all necessary providers for testing.
 * Mocks are applied globally via component-setup.ts, so no wrapper needed for now.
 * This utility exists as the single place to add providers when needed.
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  return {
    user: userEvent.setup(),
    ...render(ui, { ...options }),
  };
}

export { render, userEvent };
