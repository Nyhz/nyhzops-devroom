import type { Page } from '@playwright/test';

/**
 * Navigate to a section via the sidebar.
 */
export async function navigateTo(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

/**
 * Wait for a tactical card element to appear.
 */
export async function waitForTacCard(page: Page) {
  await page.waitForSelector('[class*="tac-card"], [data-testid="tac-card"]', {
    timeout: 10_000,
  });
}

/**
 * Get all visible status badges on the page.
 */
export async function getStatusBadges(page: Page) {
  return page.locator('[class*="tac-badge"], [data-testid="tac-badge"]').allTextContents();
}

/**
 * Wait for page navigation to complete after clicking a link.
 */
export async function waitForNavigation(page: Page) {
  await page.waitForLoadState('networkidle');
}
