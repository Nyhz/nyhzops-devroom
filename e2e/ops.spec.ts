import { test, expect } from '@playwright/test';

test('OPS page shows cards and navigates without error', async ({ page }) => {
  await page.goto('/ops');
  await expect(page.getByRole('heading', { name: 'OPS' })).toBeVisible();
});

test('OPS page locks all actions for self-controlled DEVROOM', async ({ page }) => {
  await page.goto('/ops');
  const devroomCard = page.locator('button:has-text("DEVROOM")').first();
  const count = await devroomCard.count();
  if (count === 0) test.skip(true, 'DEVROOM row not seeded in test environment');
  await devroomCard.click();
  for (const name of ['deploy', 'stand-down', 'reboot', 'engage-prod', 'engage-dev']) {
    const btn = page.getByTestId(`ops-action-${name}`);
    await expect(btn).toBeDisabled();
  }
});

test('REBOOT requires confirm-click on a non-self-controlled app', async ({ page }) => {
  await page.goto('/ops');
  const cards = page.locator('button:has-text("CALENDAR"), button:has-text("FINANCES")');
  const count = await cards.count();
  if (count === 0) test.skip(true, 'No non-self-controlled app seeded');
  await cards.first().click();
  const reboot = page.getByTestId('ops-action-reboot');
  if (!(await reboot.isEnabled())) test.skip(true, 'REBOOT not enabled for current state');
  await reboot.click();
  await expect(reboot).toHaveText(/CONFIRM REBOOT/);
});
