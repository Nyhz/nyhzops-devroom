import { test, expect, type Page } from '@playwright/test';

/**
 * Bypass the War Room boot animation by setting sessionStorage before navigation.
 */
async function bypassBootGate(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('devroom-booted', 'true');
  });
}

/**
 * Create a battlefield via the UI form with skipBootstrap enabled.
 * Returns the battlefield ID extracted from the redirect URL.
 */
async function createTestBattlefield(page: Page, name: string): Promise<string> {
  await page.goto('/battlefields/new');
  await page.waitForLoadState('networkidle');

  // Fill in battlefield name
  const nameInput = page.locator('input').first();
  await nameInput.fill(name);

  // Skip bootstrap so battlefield goes straight to active
  await page.getByText("Skip bootstrap — I'll provide my own CLAUDE.md").click();

  // Submit
  await page.getByRole('button', { name: 'CREATE BATTLEFIELD' }).click();

  // Wait for redirect to battlefield overview page
  await page.waitForURL(/\/battlefields\/[A-Za-z0-9]+/, { timeout: 15_000 });
  await page.waitForLoadState('networkidle');

  const url = page.url();
  const match = url.match(/\/battlefields\/([A-Za-z0-9]+)/);
  if (!match) throw new Error(`Could not extract battlefield ID from URL: ${url}`);
  return match[1];
}

test.describe('Create Mission Flow', () => {
  let battlefieldId: string;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await bypassBootGate(page);
    battlefieldId = await createTestBattlefield(page, 'E2E Mission Test');
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    await bypassBootGate(page);
  });

  test('deploys a mission via SAVE & DEPLOY and verifies it in the list', async ({ page }) => {
    await page.goto(`/battlefields/${battlefieldId}`);
    await page.waitForLoadState('networkidle');

    // Verify deploy mission form is visible
    await expect(page.getByText('DEPLOY MISSION')).toBeVisible();

    // Fill in the mission briefing
    const briefingTextarea = page.locator('textarea').first();
    await briefingTextarea.fill('This is an E2E test mission for deployment.');

    // SAVE & DEPLOY button should be enabled
    const saveAndDeployBtn = page.getByRole('button', { name: 'SAVE & DEPLOY' });
    await expect(saveAndDeployBtn).toBeEnabled();

    // Deploy the mission
    await saveAndDeployBtn.click();

    // Wait for the toast confirmation and page refresh
    await page.waitForLoadState('networkidle');

    // Verify the mission appears in the MISSIONS list
    await expect(page.getByText('MISSIONS')).toBeVisible();

    // The mission should appear with its auto-generated title or briefing excerpt
    // and a status badge (QUEUED after SAVE & DEPLOY)
    await expect(page.getByText('QUEUED').first()).toBeVisible({ timeout: 10_000 });

    // Verify VIEW link exists
    await expect(page.getByText('VIEW').first()).toBeVisible();
  });

  test('saves a mission in STANDBY via SAVE button', async ({ page }) => {
    await page.goto(`/battlefields/${battlefieldId}`);
    await page.waitForLoadState('networkidle');

    // Fill in the briefing
    const briefingTextarea = page.locator('textarea').first();
    await briefingTextarea.fill('Standby mission — do not deploy yet.');

    // Click SAVE (not SAVE & DEPLOY)
    const saveBtn = page.getByRole('button', { name: 'SAVE', exact: true });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // Wait for page update
    await page.waitForLoadState('networkidle');

    // Verify STANDBY badge appears in the mission list
    await expect(page.getByText('STANDBY').first()).toBeVisible({ timeout: 10_000 });
  });

  test('navigates to mission detail page and verifies content', async ({ page }) => {
    await page.goto(`/battlefields/${battlefieldId}`);
    await page.waitForLoadState('networkidle');

    // Click the first VIEW link to go to mission detail
    const viewLink = page.getByText('VIEW').first();
    await expect(viewLink).toBeVisible({ timeout: 10_000 });
    await viewLink.click();

    // Wait for mission detail page
    await page.waitForURL(/\/missions\/[A-Za-z0-9]+/, { timeout: 10_000 });
    await page.waitForLoadState('networkidle');

    // Verify mission detail page elements
    await expect(page.getByText('MISSION:')).toBeVisible();
    await expect(page.getByText('BRIEFING')).toBeVisible();

    // Verify asset info is shown
    await expect(page.getByText('Asset:')).toBeVisible();

    // Verify priority is shown
    await expect(page.getByText('Priority:')).toBeVisible();
  });

  test('shows correct action buttons for STANDBY mission', async ({ page }) => {
    await page.goto(`/battlefields/${battlefieldId}`);
    await page.waitForLoadState('networkidle');

    // Find and click the STANDBY mission's VIEW link
    // Look for the STANDBY badge row, then click its VIEW link
    const standbyRow = page.locator('text=STANDBY').first().locator('..').locator('..');
    const viewLink = standbyRow.getByText('VIEW');

    // Fallback: if the structured approach fails, just find a VIEW link near STANDBY
    if (!(await viewLink.isVisible().catch(() => false))) {
      // Navigate to the last mission (most recently created standby)
      const allViewLinks = page.getByText('VIEW');
      await allViewLinks.last().click();
    } else {
      await viewLink.click();
    }

    await page.waitForURL(/\/missions\/[A-Za-z0-9]+/, { timeout: 10_000 });
    await page.waitForLoadState('networkidle');

    // STANDBY missions should show DEPLOY and ABANDON buttons
    await expect(page.getByRole('button', { name: 'DEPLOY' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'ABANDON' })).toBeVisible();
  });

  test('validates empty briefing disables submit buttons', async ({ page }) => {
    await page.goto(`/battlefields/${battlefieldId}`);
    await page.waitForLoadState('networkidle');

    // With empty briefing, both buttons should be disabled
    const saveBtn = page.getByRole('button', { name: 'SAVE', exact: true });
    const saveAndDeployBtn = page.getByRole('button', { name: 'SAVE & DEPLOY' });

    await expect(saveBtn).toBeDisabled();
    await expect(saveAndDeployBtn).toBeDisabled();

    // Type something, buttons should enable
    const briefingTextarea = page.locator('textarea').first();
    await briefingTextarea.fill('Some briefing text');

    await expect(saveBtn).toBeEnabled();
    await expect(saveAndDeployBtn).toBeEnabled();

    // Clear it, buttons should disable again
    await briefingTextarea.fill('');

    await expect(saveBtn).toBeDisabled();
    await expect(saveAndDeployBtn).toBeDisabled();
  });

  test('abandons a mission from the detail page', async ({ page }) => {
    // First create a fresh standby mission to abandon
    await page.goto(`/battlefields/${battlefieldId}`);
    await page.waitForLoadState('networkidle');

    const briefingTextarea = page.locator('textarea').first();
    await briefingTextarea.fill('Mission to be abandoned in E2E test.');

    await page.getByRole('button', { name: 'SAVE', exact: true }).click();
    await page.waitForLoadState('networkidle');

    // Navigate to that mission's detail page (last VIEW link = newest mission)
    await page.getByText('VIEW').last().click();
    await page.waitForURL(/\/missions\/[A-Za-z0-9]+/, { timeout: 10_000 });
    await page.waitForLoadState('networkidle');

    // Click the ABANDON button
    const abandonBtn = page.getByRole('button', { name: 'ABANDON' });
    await expect(abandonBtn).toBeVisible({ timeout: 10_000 });
    await abandonBtn.click();

    // The confirm dialog should appear with ABANDON and ABANDON & REMOVE options
    await expect(page.getByText('CONFIRM ABANDON')).toBeVisible({ timeout: 5_000 });

    // Click the ABANDON action (first action in the dialog)
    const confirmAbandonBtn = page.locator('dialog, [role="dialog"]').getByRole('button', { name: 'ABANDON', exact: true });
    await confirmAbandonBtn.click();

    // Wait for page refresh — status should change to ABANDONED
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('ABANDONED').first()).toBeVisible({ timeout: 10_000 });
  });
});
