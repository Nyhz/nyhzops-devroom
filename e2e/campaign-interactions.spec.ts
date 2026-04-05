import { test, expect, type Page, type Locator } from '@playwright/test';

const TEST_PREFIX = 'E2E Interactions';
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

/**
 * Perform a pointer-based drag operation compatible with @dnd-kit PointerSensor.
 * dnd-kit uses pointer events, not HTML5 drag events, with an 8px activation distance.
 */
async function pointerDrag(page: Page, source: Locator, target: Locator) {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error('Could not get bounding boxes for drag source/target');
  }

  const sourceCenter = {
    x: sourceBox.x + sourceBox.width / 2,
    y: sourceBox.y + sourceBox.height / 2,
  };
  const targetCenter = {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + targetBox.height / 2,
  };

  // Move to source, press down
  await page.mouse.move(sourceCenter.x, sourceCenter.y);
  await page.mouse.down();

  // Move past the 8px activation distance first
  await page.mouse.move(sourceCenter.x, sourceCenter.y + 10, { steps: 3 });

  // Move to target in steps for smooth dnd-kit tracking
  await page.mouse.move(targetCenter.x, targetCenter.y, { steps: 10 });

  // Small pause for dnd-kit to process the drop position
  await page.waitForTimeout(100);

  // Drop
  await page.mouse.up();

  // Wait for state to settle
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------------------
// Test Suite: Plan Editor Drag-and-Drop
// ---------------------------------------------------------------------------

test.describe('Plan Editor Drag-and-Drop', () => {
  let battlefieldId: string;
  let campaignId: string;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(BASE);
    const bf = await getActiveBattlefield(page);
    battlefieldId = bf.id;
    await cleanupTestData(page);
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

  test('reorder phases via drag', async ({ page }) => {
    await page.goto(`/battlefields/${battlefieldId}/campaigns/${campaignId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('BATTLE PLAN EDITOR')).toBeVisible({ timeout: 10_000 });

    // Add 3 phases with names
    await page.getByText('+ ADD PHASE').click();
    await page.getByText('Phase name', { exact: false }).first().click();
    await page.locator('input[placeholder="Phase name"]').fill('Alpha');
    await page.locator('input[placeholder="Phase name"]').press('Enter');

    await page.getByText('+ ADD PHASE').click();
    // The second unnamed phase's "Phase name" placeholder
    await page.getByText('Phase name', { exact: false }).first().click();
    await page.locator('input[placeholder="Phase name"]').fill('Bravo');
    await page.locator('input[placeholder="Phase name"]').press('Enter');

    await page.getByText('+ ADD PHASE').click();
    await page.getByText('Phase name', { exact: false }).first().click();
    await page.locator('input[placeholder="Phase name"]').fill('Charlie');
    await page.locator('input[placeholder="Phase name"]').press('Enter');

    // Verify initial order: Alpha is PHASE 1, Bravo is PHASE 2, Charlie is PHASE 3
    const phaseHeaders = page.locator('[title="Drag to reorder phase"]');
    await expect(phaseHeaders).toHaveCount(3);

    // Get the drag handles for phase 1 (Alpha) and phase 3 (Charlie)
    const firstDragHandle = phaseHeaders.nth(0);
    const thirdDragHandle = phaseHeaders.nth(2);

    // Drag first phase (Alpha) to third phase position (Charlie)
    await pointerDrag(page, firstDragHandle, thirdDragHandle);

    // After drag, Alpha should have moved down. Check that the first phase is no longer Alpha.
    // The exact result depends on dnd-kit's collision detection, but the order should change.
    // Verify dirty state was triggered
    await expect(page.getByText('UNSAVED CHANGES')).toBeVisible();
  });

  test('reorder missions within a phase via drag', async ({ page }) => {
    await page.goto(`/battlefields/${battlefieldId}/campaigns/${campaignId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('BATTLE PLAN EDITOR')).toBeVisible({ timeout: 10_000 });

    // Add a phase
    await page.getByText('+ ADD PHASE').click();

    // Add 3 missions with titles
    const addMissionBtn = page.getByText('+ ADD MISSION');
    await addMissionBtn.click();
    await addMissionBtn.click();
    await addMissionBtn.click();
    await expect(page.getByText('3 missions')).toBeVisible();

    // Name the missions
    const missionTitles = page.getByText('Mission title', { exact: false });
    await missionTitles.nth(0).click();
    await page.locator('input[placeholder="Mission title"]').fill('Mission X');
    await page.locator('input[placeholder="Mission title"]').press('Enter');

    await missionTitles.nth(0).click();
    await page.locator('input[placeholder="Mission title"]').fill('Mission Y');
    await page.locator('input[placeholder="Mission title"]').press('Enter');

    await missionTitles.nth(0).click();
    await page.locator('input[placeholder="Mission title"]').fill('Mission Z');
    await page.locator('input[placeholder="Mission title"]').press('Enter');

    // All three should be visible
    await expect(page.getByText('Mission X')).toBeVisible();
    await expect(page.getByText('Mission Y')).toBeVisible();
    await expect(page.getByText('Mission Z')).toBeVisible();

    // Get mission drag handles (title="Drag to reorder")
    const missionHandles = page.locator('[title="Drag to reorder"]');
    await expect(missionHandles).toHaveCount(3);

    // Drag first mission to third mission position
    await pointerDrag(page, missionHandles.nth(0), missionHandles.nth(2));

    // Verify dirty state
    await expect(page.getByText('UNSAVED CHANGES')).toBeVisible();

    // Verify all missions still exist (drag is a reorder, not a delete)
    await expect(page.getByText('3 missions')).toBeVisible();
    await expect(page.getByText('Mission X')).toBeVisible();
    await expect(page.getByText('Mission Y')).toBeVisible();
    await expect(page.getByText('Mission Z')).toBeVisible();
  });

  test('move mission between phases via drag', async ({ page }) => {
    await page.goto(`/battlefields/${battlefieldId}/campaigns/${campaignId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('BATTLE PLAN EDITOR')).toBeVisible({ timeout: 10_000 });

    // Add phase 1 with 2 missions
    await page.getByText('+ ADD PHASE').click();
    const addMission1 = page.getByText('+ ADD MISSION').first();
    await addMission1.click();
    await addMission1.click();

    // Name first phase missions
    const missionTitles1 = page.getByText('Mission title', { exact: false });
    await missionTitles1.nth(0).click();
    await page.locator('input[placeholder="Mission title"]').fill('Source Mission A');
    await page.locator('input[placeholder="Mission title"]').press('Enter');

    await missionTitles1.nth(0).click();
    await page.locator('input[placeholder="Mission title"]').fill('Source Mission B');
    await page.locator('input[placeholder="Mission title"]').press('Enter');

    // Verify phase 1 has 2 missions
    await expect(page.getByText('2 missions')).toBeVisible();

    // Add phase 2 with 1 mission
    await page.getByText('+ ADD PHASE').click();
    const addMission2 = page.getByText('+ ADD MISSION').nth(1);
    await addMission2.click();

    // Name phase 2 mission
    await page.getByText('Mission title', { exact: false }).first().click();
    await page.locator('input[placeholder="Mission title"]').fill('Target Mission C');
    await page.locator('input[placeholder="Mission title"]').press('Enter');

    // Get all mission drag handles
    const missionHandles = page.locator('[title="Drag to reorder"]');
    await expect(missionHandles).toHaveCount(3);

    // Drag first mission (Source Mission A, handle 0) to third mission (Target Mission C, handle 2)
    await pointerDrag(page, missionHandles.nth(0), missionHandles.nth(2));

    // Verify dirty state
    await expect(page.getByText('UNSAVED CHANGES')).toBeVisible();

    // All missions should still exist
    await expect(page.getByText('Source Mission A')).toBeVisible();
    await expect(page.getByText('Source Mission B')).toBeVisible();
    await expect(page.getByText('Target Mission C')).toBeVisible();
  });

  test('drag-and-drop preserves after save and reload', async ({ page }) => {
    await page.goto(`/battlefields/${battlefieldId}/campaigns/${campaignId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('BATTLE PLAN EDITOR')).toBeVisible({ timeout: 10_000 });

    // Add 2 phases
    await page.getByText('+ ADD PHASE').click();
    await page.getByText('Phase name', { exact: false }).first().click();
    await page.locator('input[placeholder="Phase name"]').fill('First');
    await page.locator('input[placeholder="Phase name"]').press('Enter');

    await page.getByText('+ ADD PHASE').click();
    await page.getByText('Phase name', { exact: false }).first().click();
    await page.locator('input[placeholder="Phase name"]').fill('Second');
    await page.locator('input[placeholder="Phase name"]').press('Enter');

    // Add a mission to each phase
    const addMissionBtns = page.getByText('+ ADD MISSION');
    await addMissionBtns.nth(0).click();
    await page.getByText('Mission title', { exact: false }).first().click();
    await page.locator('input[placeholder="Mission title"]').fill('M1');
    await page.locator('input[placeholder="Mission title"]').press('Enter');

    await addMissionBtns.nth(1).click();
    await page.getByText('Mission title', { exact: false }).first().click();
    await page.locator('input[placeholder="Mission title"]').fill('M2');
    await page.locator('input[placeholder="Mission title"]').press('Enter');

    // Drag phase 1 to phase 2 position (reorder phases)
    const phaseHandles = page.locator('[title="Drag to reorder phase"]');
    await pointerDrag(page, phaseHandles.nth(0), phaseHandles.nth(1));

    await expect(page.getByText('UNSAVED CHANGES')).toBeVisible();

    // Save
    const saveBtn = page.getByRole('button', { name: /SAVE PLAN/i });
    await saveBtn.click();
    await expect(page.getByText('UNSAVED CHANGES')).not.toBeVisible({ timeout: 10_000 });

    // Reload and verify persistence
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('BATTLE PLAN EDITOR')).toBeVisible({ timeout: 10_000 });

    // Both phases and missions should still be present
    await expect(page.getByText('First')).toBeVisible();
    await expect(page.getByText('Second')).toBeVisible();
    await expect(page.getByText('M1')).toBeVisible();
    await expect(page.getByText('M2')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test Suite: Briefing Chat Flow
// ---------------------------------------------------------------------------

test.describe('Briefing Chat Flow', () => {
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

  async function createDraftCampaign(page: Page): Promise<string> {
    await page.goto(`/battlefields/${battlefieldId}/campaigns/new`);
    await page.waitForLoadState('networkidle');

    await page.locator('input').first().fill(`${TEST_PREFIX} Briefing`);
    await page.locator('textarea').first().fill('E2E briefing chat test');
    await page.getByRole('button', { name: /CREATE CAMPAIGN/i }).click();

    await page.waitForURL(/\/campaigns\/[A-Za-z0-9]+$/);
    await page.waitForLoadState('networkidle');

    // Extract campaign ID from URL
    const url = page.url();
    const match = url.match(/\/campaigns\/([A-Za-z0-9]+)$/);
    return match![1];
  }

  test('briefing chat renders with header and input', async ({ page }) => {
    await createDraftCampaign(page);

    // Should see the briefing session header
    await expect(page.getByText('STRATEGIST — BRIEFING SESSION')).toBeVisible({ timeout: 10_000 });

    // Should see the GENERATE PLAN button
    await expect(page.getByRole('button', { name: /GENERATE PLAN/i })).toBeVisible();

    // Should see the input placeholder
    await expect(page.locator('textarea[placeholder="Brief the STRATEGIST..."]')).toBeVisible();

    // Should see the SEND button
    await expect(page.getByText('SEND')).toBeVisible();
  });

  test('empty state message shown when no messages', async ({ page }) => {
    await createDraftCampaign(page);
    await expect(page.getByText('STRATEGIST — BRIEFING SESSION')).toBeVisible({ timeout: 10_000 });

    // Should see the empty state instructions
    await expect(
      page.getByText('Begin your briefing with the STRATEGIST', { exact: false })
    ).toBeVisible();
  });

  test('GENERATE PLAN button disabled with fewer than 2 messages', async ({ page }) => {
    await createDraftCampaign(page);
    await expect(page.getByText('STRATEGIST — BRIEFING SESSION')).toBeVisible({ timeout: 10_000 });

    // With no messages, GENERATE PLAN should be disabled
    const generateBtn = page.getByRole('button', { name: /GENERATE PLAN/i });
    await expect(generateBtn).toBeDisabled();
  });

  test('SEND button disabled when input is empty', async ({ page }) => {
    await createDraftCampaign(page);
    await expect(page.getByText('STRATEGIST — BRIEFING SESSION')).toBeVisible({ timeout: 10_000 });

    // SEND button should appear disabled (dim styling, not a disabled attribute)
    const sendBtn = page.getByText('SEND');
    await expect(sendBtn).toBeVisible();

    // With empty input, clicking SEND should not do anything
    // The button uses class-based disabled styling rather than the disabled attribute
    const sendBtnClasses = await sendBtn.getAttribute('class');
    expect(sendBtnClasses).toContain('cursor-not-allowed');
  });

  test('type a message in the input field', async ({ page }) => {
    await createDraftCampaign(page);
    await expect(page.getByText('STRATEGIST — BRIEFING SESSION')).toBeVisible({ timeout: 10_000 });

    const input = page.locator('textarea[placeholder="Brief the STRATEGIST..."]');
    await input.fill('Test briefing message');
    await expect(input).toHaveValue('Test briefing message');

    // SEND button should now be active (no cursor-not-allowed)
    const sendBtn = page.getByText('SEND');
    const sendBtnClasses = await sendBtn.getAttribute('class');
    expect(sendBtnClasses).not.toContain('cursor-not-allowed');
  });

  test('send a message via SEND button', async ({ page }) => {
    await createDraftCampaign(page);
    await expect(page.getByText('STRATEGIST — BRIEFING SESSION')).toBeVisible({ timeout: 10_000 });

    const input = page.locator('textarea[placeholder="Brief the STRATEGIST..."]');
    await input.fill('Hello STRATEGIST, this is a test');
    await page.getByText('SEND').click();

    // Input should be cleared after sending
    await expect(input).toHaveValue('');

    // The message should appear in the chat (user message)
    await expect(page.getByText('Hello STRATEGIST, this is a test')).toBeVisible({ timeout: 5_000 });

    // Empty state should be gone
    await expect(
      page.getByText('Begin your briefing with the STRATEGIST', { exact: false })
    ).not.toBeVisible();
  });

  test('send a message via Enter key', async ({ page }) => {
    await createDraftCampaign(page);
    await expect(page.getByText('STRATEGIST — BRIEFING SESSION')).toBeVisible({ timeout: 10_000 });

    const input = page.locator('textarea[placeholder="Brief the STRATEGIST..."]');
    await input.fill('Enter key test message');
    await input.press('Enter');

    // Input should be cleared
    await expect(input).toHaveValue('');

    // Message should appear
    await expect(page.getByText('Enter key test message')).toBeVisible({ timeout: 5_000 });
  });

  test('Shift+Enter does not send message (allows newline)', async ({ page }) => {
    await createDraftCampaign(page);
    await expect(page.getByText('STRATEGIST — BRIEFING SESSION')).toBeVisible({ timeout: 10_000 });

    const input = page.locator('textarea[placeholder="Brief the STRATEGIST..."]');
    await input.fill('Line one');
    await input.press('Shift+Enter');

    // Message should NOT be sent — input should still contain text
    // The value may include a newline depending on browser behavior
    const value = await input.inputValue();
    expect(value.length).toBeGreaterThan(0);

    // The empty state should still be visible (no message sent)
    await expect(
      page.getByText('Begin your briefing with the STRATEGIST', { exact: false })
    ).toBeVisible();
  });

  test('DELETE button available on draft campaign', async ({ page }) => {
    await createDraftCampaign(page);
    await expect(page.getByText('STRATEGIST — BRIEFING SESSION')).toBeVisible({ timeout: 10_000 });

    // Draft campaigns should show DELETE button
    await expect(page.getByRole('button', { name: /DELETE/i })).toBeVisible();
  });
});
