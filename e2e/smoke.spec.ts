import { test, expect } from '@playwright/test';

test.describe('Smoke Tests', () => {
  test('home page loads successfully', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/NYHZ OPS/);
  });

  test('HQ page renders content', async ({ page }) => {
    await page.goto('/');
    // Should show either the empty state or the HQ dashboard
    const body = page.locator('body');
    await expect(body).toBeVisible();

    // Look for known UI elements — either "NO BATTLEFIELDS DEPLOYED" or "HEADQUARTERS"
    const hasContent = await page
      .getByText(/NO BATTLEFIELDS DEPLOYED|HEADQUARTERS/i)
      .first()
      .isVisible()
      .catch(() => false);

    expect(hasContent).toBeTruthy();
  });
});
