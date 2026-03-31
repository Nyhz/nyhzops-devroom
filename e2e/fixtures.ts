import { test as base, type Page } from '@playwright/test';

/**
 * Wait for the app shell to be fully loaded (sidebar + main content area).
 */
async function waitForAppShell(page: Page) {
  await page.waitForSelector('nav', { timeout: 15_000 });
}

/**
 * Custom fixtures for DEVROOM E2E tests.
 */
export const test = base.extend<{ appPage: Page }>({
  appPage: async ({ page }, use) => {
    await page.goto('/');
    await waitForAppShell(page);
    await use(page);
  },
});

export { expect } from '@playwright/test';
