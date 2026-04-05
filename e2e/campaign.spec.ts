import { test, expect, type Page } from '@playwright/test';

const TEST_PREFIX = 'E2E Test Campaign';
const BASE = 'http://localhost:3000';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function api(page: Page, body: Record<string, unknown>) {
  return page.evaluate(async (b) => {
    const res = await fetch('/api/test-fixtures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(b),
    });
    return res.json();
  }, body);
}

async function getActiveBattlefield(page: Page) {
  const result = await api(page, { action: 'get-battlefield' });
  if (!result.battlefield) {
    throw new Error('No active battlefield found — E2E tests require at least one active battlefield');
  }
  return result.battlefield as { id: string; codename: string };
}

async function cleanupTestData(page: Page) {
  await api(page, { action: 'cleanup', prefix: TEST_PREFIX });
}

// ---------------------------------------------------------------------------
// Test Suite: Create Campaign Flow
// ---------------------------------------------------------------------------

test.describe('Create Campaign Flow', () => {
  let battlefieldId: string;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(BASE);
    const bf = await getActiveBattlefield(page);
    battlefieldId = bf.id;
    await cleanupTestData(page);
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(BASE);
    await cleanupTestData(page);
    await page.close();
  });

  test('navigate to campaigns page and see empty or populated state', async ({ page }) => {
    await page.goto(`/battlefields/${battlefieldId}/campaigns`);
    await page.waitForLoadState('networkidle');

    // Should see either campaign cards or the empty state message
    const hasContent = await page
      .getByText(/CAMPAIGNS|No campaigns deployed/i)
      .first()
      .isVisible()
      .catch(() => false);
    expect(hasContent).toBeTruthy();
  });

  test('click NEW CAMPAIGN and see the form', async ({ page }) => {
    await page.goto(`/battlefields/${battlefieldId}/campaigns`);
    await page.waitForLoadState('networkidle');

    // Click the NEW CAMPAIGN button
    await page.getByRole('link', { name: /NEW CAMPAIGN/i }).click();
    await page.waitForLoadState('networkidle');

    // Should be on the new campaign page
    expect(page.url()).toContain('/campaigns/new');

    // Should see the form fields
    await expect(page.getByText('CAMPAIGN NAME')).toBeVisible();
    await expect(page.getByText('OBJECTIVE')).toBeVisible();
    await expect(page.getByRole('button', { name: /CREATE CAMPAIGN/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /CANCEL/i })).toBeVisible();
  });

  test('CREATE CAMPAIGN button disabled with empty fields', async ({ page }) => {
    await page.goto(`/battlefields/${battlefieldId}/campaigns/new`);
    await page.waitForLoadState('networkidle');

    const createBtn = page.getByRole('button', { name: /CREATE CAMPAIGN/i });
    await expect(createBtn).toBeDisabled();
  });

  test('create a campaign and redirect to detail page in DRAFT status', async ({ page }) => {
    await page.goto(`/battlefields/${battlefieldId}/campaigns/new`);
    await page.waitForLoadState('networkidle');

    // Fill in campaign name
    const nameInput = page.locator('input').first();
    await nameInput.fill(`${TEST_PREFIX} Creation`);

    // Fill in objective
    const objectiveTextarea = page.locator('textarea').first();
    await objectiveTextarea.fill('E2E test campaign objective — verifying creation flow');

    // Create button should now be enabled
    const createBtn = page.getByRole('button', { name: /CREATE CAMPAIGN/i });
    await expect(createBtn).toBeEnabled();

    // Submit
    await createBtn.click();

    // Should redirect to campaign detail page
    await page.waitForURL(/\/campaigns\/[A-Za-z0-9]+$/);
    await page.waitForLoadState('networkidle');

    // Should see the campaign name and DRAFT status indicators
    // In draft mode, the BriefingChat is shown with "STRATEGIST — BRIEFING SESSION"
    await expect(page.getByText('STRATEGIST — BRIEFING SESSION')).toBeVisible({ timeout: 10_000 });

    // Should see DELETE button (draft status control)
    await expect(page.getByRole('button', { name: /DELETE/i })).toBeVisible();
  });

  test('campaign appears in the campaigns list', async ({ page }) => {
    // First create a campaign
    await page.goto(`/battlefields/${battlefieldId}/campaigns/new`);
    await page.waitForLoadState('networkidle');

    await page.locator('input').first().fill(`${TEST_PREFIX} List Check`);
    await page.locator('textarea').first().fill('Verify campaign appears in list');
    await page.getByRole('button', { name: /CREATE CAMPAIGN/i }).click();
    await page.waitForURL(/\/campaigns\/[A-Za-z0-9]+$/);

    // Navigate to campaigns list
    await page.goto(`/battlefields/${battlefieldId}/campaigns`);
    await page.waitForLoadState('networkidle');

    // The campaign should appear in the list
    await expect(page.getByText(`${TEST_PREFIX} List Check`)).toBeVisible();
    await expect(page.getByText('DRAFT')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test Suite: Plan Editor Flow
// ---------------------------------------------------------------------------

test.describe('Plan Editor Flow', () => {
  let battlefieldId: string;
  let campaignId: string;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(BASE);
    const bf = await getActiveBattlefield(page);
    battlefieldId = bf.id;
    // Clean up first
    await cleanupTestData(page);
    // Create a campaign in planning status via test fixture
    const result = await api(page, {
      action: 'create-planning-campaign',
      battlefieldId,
    });
    campaignId = result.campaignId;
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(BASE);
    await cleanupTestData(page);
    await page.close();
  });

  test('plan editor renders for planning campaign', async ({ page }) => {
    await page.goto(`/battlefields/${battlefieldId}/campaigns/${campaignId}`);
    await page.waitForLoadState('networkidle');

    // Should see the plan editor header
    await expect(page.getByText('BATTLE PLAN EDITOR')).toBeVisible({ timeout: 10_000 });

    // Should see SAVE PLAN button (disabled since no changes)
    const saveBtn = page.getByRole('button', { name: /SAVE PLAN/i });
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toBeDisabled();

    // Should see ADD PHASE button
    await expect(page.getByText('+ ADD PHASE')).toBeVisible();

    // Should see campaign controls for planning status
    await expect(page.getByRole('button', { name: /GREEN LIGHT/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /BACK TO BRIEFING/i })).toBeVisible();
  });

  test('add a phase', async ({ page }) => {
    await page.goto(`/battlefields/${battlefieldId}/campaigns/${campaignId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('BATTLE PLAN EDITOR')).toBeVisible({ timeout: 10_000 });

    // Click ADD PHASE
    await page.getByText('+ ADD PHASE').click();

    // Should see PHASE 1 label
    await expect(page.getByText('PHASE 1')).toBeVisible();

    // Should see UNSAVED CHANGES indicator
    await expect(page.getByText('UNSAVED CHANGES')).toBeVisible();

    // SAVE PLAN should be enabled
    await expect(page.getByRole('button', { name: /SAVE PLAN/i })).toBeEnabled();

    // Should see ADD MISSION button inside the phase
    await expect(page.getByText('+ ADD MISSION')).toBeVisible();

    // Should see 0 missions count
    await expect(page.getByText('0 missions')).toBeVisible();
  });

  test('add a phase, edit its name inline, and add a mission', async ({ page }) => {
    await page.goto(`/battlefields/${battlefieldId}/campaigns/${campaignId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('BATTLE PLAN EDITOR')).toBeVisible({ timeout: 10_000 });

    // Add a phase
    await page.getByText('+ ADD PHASE').click();
    await expect(page.getByText('PHASE 1')).toBeVisible();

    // Click on the phase name placeholder to edit it (InlineEdit)
    await page.getByText('Phase name', { exact: false }).first().click();

    // Type a phase name into the now-visible input
    const phaseNameInput = page.locator('input[placeholder="Phase name"]');
    await expect(phaseNameInput).toBeVisible();
    await phaseNameInput.fill('Phase 1 - E2E Test');
    await phaseNameInput.press('Enter');

    // Phase name should be committed
    await expect(page.getByText('Phase 1 - E2E Test')).toBeVisible();

    // Click ADD MISSION
    await page.getByText('+ ADD MISSION').click();

    // Should see mission card with title placeholder
    await expect(page.getByText('Mission title', { exact: false }).first()).toBeVisible();

    // Should see 1 mission count
    await expect(page.getByText('1 mission')).toBeVisible();

    // Click mission title to edit it
    await page.getByText('Mission title', { exact: false }).first().click();
    const missionTitleInput = page.locator('input[placeholder="Mission title"]');
    await expect(missionTitleInput).toBeVisible();
    await missionTitleInput.fill('Test Mission 1');
    await missionTitleInput.press('Enter');

    // Mission title should be committed
    await expect(page.getByText('Test Mission 1')).toBeVisible();
  });

  test('expand briefing and fill it in', async ({ page }) => {
    await page.goto(`/battlefields/${battlefieldId}/campaigns/${campaignId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('BATTLE PLAN EDITOR')).toBeVisible({ timeout: 10_000 });

    // Add a phase and a mission
    await page.getByText('+ ADD PHASE').click();
    await page.getByText('+ ADD MISSION').click();

    // Expand the briefing section
    const briefingToggle = page.getByText('BRIEFING', { exact: false }).first();
    await briefingToggle.click();

    // Should show the briefing textarea
    const briefingTextarea = page.locator('textarea[placeholder="Mission briefing..."]');
    await expect(briefingTextarea).toBeVisible();

    // Fill in the briefing
    await briefingTextarea.fill('Test briefing content for E2E testing');
    await expect(briefingTextarea).toHaveValue('Test briefing content for E2E testing');
  });

  test('add multiple phases', async ({ page }) => {
    await page.goto(`/battlefields/${battlefieldId}/campaigns/${campaignId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('BATTLE PLAN EDITOR')).toBeVisible({ timeout: 10_000 });

    // Add phase 1
    await page.getByText('+ ADD PHASE').click();
    await expect(page.getByText('PHASE 1')).toBeVisible();

    // Add phase 2
    await page.getByText('+ ADD PHASE').click();
    await expect(page.getByText('PHASE 2')).toBeVisible();

    // Add phase 3
    await page.getByText('+ ADD PHASE').click();
    await expect(page.getByText('PHASE 3')).toBeVisible();

    // All three should be visible
    const phaseLabels = page.locator('text=/PHASE \\d/');
    await expect(phaseLabels).toHaveCount(3);
  });

  test('add multiple missions to a phase', async ({ page }) => {
    await page.goto(`/battlefields/${battlefieldId}/campaigns/${campaignId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('BATTLE PLAN EDITOR')).toBeVisible({ timeout: 10_000 });

    // Add a phase
    await page.getByText('+ ADD PHASE').click();

    // Add 3 missions
    const addMissionBtn = page.getByText('+ ADD MISSION');
    await addMissionBtn.click();
    await addMissionBtn.click();
    await addMissionBtn.click();

    // Should see 3 missions count
    await expect(page.getByText('3 missions')).toBeVisible();

    // Should see 3 mission title placeholders (+ the add button)
    const missionTitles = page.getByText('Mission title', { exact: false });
    await expect(missionTitles).toHaveCount(3);
  });

  test('remove a mission from a phase', async ({ page }) => {
    await page.goto(`/battlefields/${battlefieldId}/campaigns/${campaignId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('BATTLE PLAN EDITOR')).toBeVisible({ timeout: 10_000 });

    // Add a phase with 2 missions
    await page.getByText('+ ADD PHASE').click();
    const addMissionBtn = page.getByText('+ ADD MISSION');
    await addMissionBtn.click();
    await addMissionBtn.click();
    await expect(page.getByText('2 missions')).toBeVisible();

    // Delete the first mission (click ✕ button on mission card)
    // The mission delete buttons have title="Delete mission"
    const deleteBtns = page.locator('button[title="Delete mission"]');
    await deleteBtns.first().click();

    // Should now have 1 mission
    await expect(page.getByText('1 mission')).toBeVisible();
  });

  test('remove a phase', async ({ page }) => {
    await page.goto(`/battlefields/${battlefieldId}/campaigns/${campaignId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('BATTLE PLAN EDITOR')).toBeVisible({ timeout: 10_000 });

    // Add a phase (no missions — so no confirm dialog needed)
    await page.getByText('+ ADD PHASE').click();
    await expect(page.getByText('PHASE 1')).toBeVisible();

    // Delete the phase (click ✕ button on phase header)
    const deletePhaseBtn = page.locator('button[title="Delete phase"]');
    await deletePhaseBtn.click();

    // Phase 1 should be gone
    await expect(page.getByText('PHASE 1')).not.toBeVisible();
  });

  test('edit plan summary', async ({ page }) => {
    await page.goto(`/battlefields/${battlefieldId}/campaigns/${campaignId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('BATTLE PLAN EDITOR')).toBeVisible({ timeout: 10_000 });

    // Should see PLAN SUMMARY label
    await expect(page.getByText('PLAN SUMMARY')).toBeVisible();

    // Fill in the summary textarea
    const summaryTextarea = page.locator('textarea[placeholder="Campaign plan summary..."]');
    await summaryTextarea.fill('Updated plan summary for E2E test');
    await expect(summaryTextarea).toHaveValue('Updated plan summary for E2E test');

    // Should mark as dirty
    await expect(page.getByText('UNSAVED CHANGES')).toBeVisible();
  });

  test('save plan with phases and missions', async ({ page }) => {
    await page.goto(`/battlefields/${battlefieldId}/campaigns/${campaignId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('BATTLE PLAN EDITOR')).toBeVisible({ timeout: 10_000 });

    // Fill in summary
    const summaryTextarea = page.locator('textarea[placeholder="Campaign plan summary..."]');
    await summaryTextarea.fill('E2E test plan summary');

    // Add a phase
    await page.getByText('+ ADD PHASE').click();

    // Edit phase name
    await page.getByText('Phase name', { exact: false }).first().click();
    const phaseNameInput = page.locator('input[placeholder="Phase name"]');
    await phaseNameInput.fill('Phase Alpha');
    await phaseNameInput.press('Enter');

    // Add a mission
    await page.getByText('+ ADD MISSION').click();

    // Edit mission title
    await page.getByText('Mission title', { exact: false }).first().click();
    const missionTitleInput = page.locator('input[placeholder="Mission title"]');
    await missionTitleInput.fill('Alpha Mission 1');
    await missionTitleInput.press('Enter');

    // Should see unsaved changes
    await expect(page.getByText('UNSAVED CHANGES')).toBeVisible();

    // Save
    const saveBtn = page.getByRole('button', { name: /SAVE PLAN/i });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // Wait for save to complete — UNSAVED CHANGES should disappear
    await expect(page.getByText('UNSAVED CHANGES')).not.toBeVisible({ timeout: 10_000 });

    // SAVE PLAN should be disabled again (no changes)
    await expect(saveBtn).toBeDisabled();

    // Reload the page to verify persistence
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('BATTLE PLAN EDITOR')).toBeVisible({ timeout: 10_000 });

    // Verify the saved data persists
    await expect(page.getByText('Phase Alpha')).toBeVisible();
    await expect(page.getByText('Alpha Mission 1')).toBeVisible();
    await expect(page.getByText('1 mission')).toBeVisible();
  });

  test('select mission priority', async ({ page }) => {
    await page.goto(`/battlefields/${battlefieldId}/campaigns/${campaignId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('BATTLE PLAN EDITOR')).toBeVisible({ timeout: 10_000 });

    // Add a phase and mission
    await page.getByText('+ ADD PHASE').click();
    await page.getByText('+ ADD MISSION').click();

    // Find and change the priority selector
    const prioritySelect = page.locator('select').filter({ has: page.locator('option[value="critical"]') });
    await prioritySelect.selectOption('critical');

    // Verify selection
    await expect(prioritySelect).toHaveValue('critical');
  });

  test('edit phase objective inline', async ({ page }) => {
    await page.goto(`/battlefields/${battlefieldId}/campaigns/${campaignId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('BATTLE PLAN EDITOR')).toBeVisible({ timeout: 10_000 });

    // Add a phase
    await page.getByText('+ ADD PHASE').click();

    // Click on the phase objective placeholder
    await page.getByText('Phase objective', { exact: false }).first().click();

    // Fill in the objective (multiline InlineEdit uses textarea)
    const objectiveInput = page.locator('textarea[placeholder="Phase objective"]');
    await expect(objectiveInput).toBeVisible();
    await objectiveInput.fill('E2E test phase objective');
    // Blur to commit (click elsewhere)
    await page.getByText('BATTLE PLAN EDITOR').click();

    // Objective should be committed
    await expect(page.getByText('E2E test phase objective')).toBeVisible();
  });
});
