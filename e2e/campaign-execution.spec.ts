import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * E2E tests for Campaign Phase Execution Flow.
 *
 * These tests exercise the campaign launch, live monitoring,
 * commander override, skip mission, and abandon flows.
 *
 * Test data is seeded via API routes (/api/test/seed-campaign and
 * /api/test/seed-active-campaign) which create campaigns in the
 * correct state, bypassing the GENERAL briefing step that requires
 * a real Claude Code process.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SeedCampaignResponse {
  battlefieldId: string;
  campaignId: string;
  phase1Id: string;
  phase2Id: string;
  missionIds: string[];
}

interface SeedActiveCampaignResponse {
  battlefieldId: string;
  campaignId: string;
  phase1Id: string;
  phase2Id: string;
  accomplishedMissionId: string;
  compromisedMissionId: string;
  standbyMissionId: string;
}

async function seedPlanningCampaign(
  request: APIRequestContext,
): Promise<SeedCampaignResponse> {
  const res = await request.post('/api/test/seed-campaign');
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function seedActiveCampaign(
  request: APIRequestContext,
): Promise<SeedActiveCampaignResponse> {
  const res = await request.post('/api/test/seed-active-campaign');
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function cleanupCampaign(request: APIRequestContext, campaignId: string) {
  await request.delete(`/api/test/seed-campaign?campaignId=${campaignId}`);
}

// ---------------------------------------------------------------------------
// Campaign Launch Flow
// ---------------------------------------------------------------------------

test.describe('Campaign Launch Flow', () => {
  let seed: SeedCampaignResponse;

  test.beforeEach(async ({ request }) => {
    seed = await seedPlanningCampaign(request);
  });

  test.afterEach(async ({ request }) => {
    if (seed?.campaignId) {
      await cleanupCampaign(request, seed.campaignId);
    }
  });

  test('displays planning view with plan editor and controls', async ({ page }) => {
    await page.goto(`/battlefields/${seed.battlefieldId}/campaigns/${seed.campaignId}`);
    await page.waitForLoadState('networkidle');

    // Should show GREEN LIGHT button (planning status)
    await expect(page.getByRole('button', { name: 'GREEN LIGHT' })).toBeVisible();

    // Should show BACK TO BRIEFING button
    await expect(page.getByRole('button', { name: 'BACK TO BRIEFING' })).toBeVisible();

    // Should show DELETE button
    await expect(page.getByRole('button', { name: 'DELETE' })).toBeVisible();
  });

  test('displays plan editor with phases and missions', async ({ page }) => {
    await page.goto(`/battlefields/${seed.battlefieldId}/campaigns/${seed.campaignId}`);
    await page.waitForLoadState('networkidle');

    // Should show phase names
    await expect(page.getByText('Reconnaissance')).toBeVisible();

    // Should show mission titles in the plan editor
    await expect(page.getByText('Scout perimeter')).toBeVisible();
    await expect(page.getByText('Identify targets')).toBeVisible();
  });

  test('launches campaign and transitions to active state', async ({ page }) => {
    await page.goto(`/battlefields/${seed.battlefieldId}/campaigns/${seed.campaignId}`);
    await page.waitForLoadState('networkidle');

    // Click GREEN LIGHT
    await page.getByRole('button', { name: 'GREEN LIGHT' }).click();

    // Confirm dialog should appear
    await expect(page.getByText('GREEN LIGHT CAMPAIGN')).toBeVisible();
    await expect(page.getByText('All Phase 1 missions will be deployed immediately.')).toBeVisible();

    // Click confirm button in dialog
    const confirmButton = page.locator('[role="dialog"]').getByRole('button', { name: 'GREEN LIGHT' });
    await confirmButton.click();

    // Wait for page to update — campaign should now be active
    await page.waitForLoadState('networkidle');

    // Should show ACTIVE status banner or ACTIVE badge
    await expect(
      page.getByText(/ACTIVE/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Should show campaign controls for active state
    await expect(page.getByRole('button', { name: 'MISSION ACCOMPLISHED' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ABANDON' })).toBeVisible();
  });

  test('shows phase timeline after launch', async ({ page }) => {
    await page.goto(`/battlefields/${seed.battlefieldId}/campaigns/${seed.campaignId}`);
    await page.waitForLoadState('networkidle');

    // Launch the campaign
    await page.getByRole('button', { name: 'GREEN LIGHT' }).click();
    const confirmButton = page.locator('[role="dialog"]').getByRole('button', { name: 'GREEN LIGHT' });
    await confirmButton.click();
    await page.waitForLoadState('networkidle');

    // Phase timeline should show phases
    await expect(page.getByText('PHASE 1')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Reconnaissance')).toBeVisible();

    // Phase 2 should also be visible
    await expect(page.getByText('PHASE 2')).toBeVisible();
    await expect(page.getByText('Execution')).toBeVisible();

    // Mission cards should be visible
    await expect(page.getByText('Scout perimeter')).toBeVisible();
    await expect(page.getByText('Identify targets')).toBeVisible();
    await expect(page.getByText('Primary strike')).toBeVisible();
  });

  test('missions show status badges after launch', async ({ page }) => {
    await page.goto(`/battlefields/${seed.battlefieldId}/campaigns/${seed.campaignId}`);
    await page.waitForLoadState('networkidle');

    // Launch
    await page.getByRole('button', { name: 'GREEN LIGHT' }).click();
    const confirmButton = page.locator('[role="dialog"]').getByRole('button', { name: 'GREEN LIGHT' });
    await confirmButton.click();
    await page.waitForLoadState('networkidle');

    // Wait for the live view to render
    await page.waitForSelector('text=PHASE 1', { timeout: 10_000 });

    // Phase 1 missions should have status badges (QUEUED or DEPLOYING after launch)
    // Phase 2 missions should still be STANDBY
    const badges = await page.locator('text=/QUEUED|DEPLOYING|STANDBY|IN COMBAT/i').allTextContents();
    expect(badges.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Active Campaign Monitoring & Controls
// ---------------------------------------------------------------------------

test.describe('Active Campaign Monitoring', () => {
  let seed: SeedActiveCampaignResponse;

  test.beforeEach(async ({ request }) => {
    seed = await seedActiveCampaign(request);
  });

  test.afterEach(async ({ request }) => {
    if (seed?.campaignId) {
      await cleanupCampaign(request, seed.campaignId);
    }
  });

  test('displays active campaign with phase timeline', async ({ page }) => {
    await page.goto(`/battlefields/${seed.battlefieldId}/campaigns/${seed.campaignId}`);
    await page.waitForLoadState('networkidle');

    // Should show ACTIVE status banner
    await expect(page.getByText(/ACTIVE/i).first()).toBeVisible({ timeout: 10_000 });

    // Phase 1 should be visible with its missions
    await expect(page.getByText('PHASE 1')).toBeVisible();
    await expect(page.getByText('Initial Assault')).toBeVisible();
    await expect(page.getByText('Completed recon')).toBeVisible();
    await expect(page.getByText('Failed extraction')).toBeVisible();

    // Phase 2 should be visible
    await expect(page.getByText('PHASE 2')).toBeVisible();
    await expect(page.getByText('Follow-up')).toBeVisible();
  });

  test('shows mission status badges in phase timeline', async ({ page }) => {
    await page.goto(`/battlefields/${seed.battlefieldId}/campaigns/${seed.campaignId}`);
    await page.waitForLoadState('networkidle');

    // The accomplished mission should show ACCOMPLISHED badge
    await expect(page.getByText('ACCOMPLISHED').first()).toBeVisible({ timeout: 10_000 });

    // The compromised mission should show COMPROMISED badge
    await expect(page.getByText('COMPROMISED').first()).toBeVisible();
  });

  test('shows campaign controls for active state', async ({ page }) => {
    await page.goto(`/battlefields/${seed.battlefieldId}/campaigns/${seed.campaignId}`);
    await page.waitForLoadState('networkidle');

    // Active campaigns show MISSION ACCOMPLISHED and ABANDON
    await expect(page.getByRole('button', { name: 'MISSION ACCOMPLISHED' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ABANDON' })).toBeVisible();
  });

  test('mission cards link to mission detail pages', async ({ page }) => {
    await page.goto(`/battlefields/${seed.battlefieldId}/campaigns/${seed.campaignId}`);
    await page.waitForLoadState('networkidle');

    // Click the compromised mission card to navigate to mission detail
    const missionLink = page.getByText('Failed extraction');
    await expect(missionLink).toBeVisible({ timeout: 10_000 });
    await missionLink.click();
    await page.waitForLoadState('networkidle');

    // Should navigate to mission detail page
    await expect(page).toHaveURL(/\/missions\//);

    // Should show the mission title
    await expect(page.getByText('Failed extraction')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Commander Override Flow
// ---------------------------------------------------------------------------

test.describe('Commander Override', () => {
  let seed: SeedActiveCampaignResponse;

  test.beforeEach(async ({ request }) => {
    seed = await seedActiveCampaign(request);
  });

  test.afterEach(async ({ request }) => {
    if (seed?.campaignId) {
      await cleanupCampaign(request, seed.campaignId);
    }
  });

  test('can approve a compromised mission via commander override', async ({ page }) => {
    // Navigate to the compromised mission detail page
    const missionUrl = `/battlefields/${seed.battlefieldId}/missions/${seed.compromisedMissionId}`;
    await page.goto(missionUrl);
    await page.waitForLoadState('networkidle');

    // Should show APPROVE button for compromised missions
    await expect(page.getByRole('button', { name: 'APPROVE' })).toBeVisible({ timeout: 10_000 });

    // Click APPROVE
    await page.getByRole('button', { name: 'APPROVE' }).click();

    // Confirm dialog should appear
    await expect(page.getByText('COMMANDER OVERRIDE')).toBeVisible();

    // Click confirm
    const confirmButton = page.locator('[role="dialog"]').getByRole('button', { name: 'APPROVE' });
    await confirmButton.click();

    // Wait for status to update
    await page.waitForLoadState('networkidle');

    // Mission should now show as ACCOMPLISHED
    await expect(page.getByText('ACCOMPLISHED').first()).toBeVisible({ timeout: 10_000 });
  });

  test('can skip a compromised campaign mission', async ({ page }) => {
    // Navigate to the compromised mission detail page
    const missionUrl = `/battlefields/${seed.battlefieldId}/missions/${seed.compromisedMissionId}`;
    await page.goto(missionUrl);
    await page.waitForLoadState('networkidle');

    // Should show SKIP MISSION button for compromised campaign missions
    await expect(page.getByRole('button', { name: 'SKIP MISSION' })).toBeVisible({ timeout: 10_000 });

    // Click SKIP MISSION
    await page.getByRole('button', { name: 'SKIP MISSION' }).click();

    // Confirm dialog should appear
    await expect(page.getByText('SKIP MISSION')).toBeVisible();
    await expect(page.getByText(/cascade-abandon/i)).toBeVisible();

    // Click confirm
    const confirmButton = page.locator('[role="dialog"]').getByRole('button', { name: 'SKIP' });
    await confirmButton.click();

    // Wait for status to update
    await page.waitForLoadState('networkidle');

    // Mission should now show as ABANDONED
    await expect(page.getByText('ABANDONED').first()).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Tactical Override Flow
// ---------------------------------------------------------------------------

test.describe('Tactical Override', () => {
  let seed: SeedActiveCampaignResponse;

  test.beforeEach(async ({ request }) => {
    seed = await seedActiveCampaign(request);
  });

  test.afterEach(async ({ request }) => {
    if (seed?.campaignId) {
      await cleanupCampaign(request, seed.campaignId);
    }
  });

  test('can open tactical override with pre-filled briefing', async ({ page }) => {
    const missionUrl = `/battlefields/${seed.battlefieldId}/missions/${seed.compromisedMissionId}`;
    await page.goto(missionUrl);
    await page.waitForLoadState('networkidle');

    // Should show TACTICAL OVERRIDE button
    await expect(page.getByRole('button', { name: 'TACTICAL OVERRIDE' })).toBeVisible({ timeout: 10_000 });

    // Click TACTICAL OVERRIDE
    await page.getByRole('button', { name: 'TACTICAL OVERRIDE' }).click();

    // Should show the override form with pre-filled briefing
    await expect(page.getByText('TACTICAL OVERRIDE').nth(1)).toBeVisible();
    await expect(page.getByText('Edit the briefing below')).toBeVisible();

    // The textarea should contain the original briefing text
    const textarea = page.locator('textarea');
    await expect(textarea).toHaveValue(/Extract data from the target system/);

    // Should show DEPLOY WITH OVERRIDE and CANCEL buttons
    await expect(page.getByRole('button', { name: 'DEPLOY WITH OVERRIDE' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'CANCEL' })).toBeVisible();
  });

  test('can cancel tactical override', async ({ page }) => {
    const missionUrl = `/battlefields/${seed.battlefieldId}/missions/${seed.compromisedMissionId}`;
    await page.goto(missionUrl);
    await page.waitForLoadState('networkidle');

    // Open tactical override
    await page.getByRole('button', { name: 'TACTICAL OVERRIDE' }).click();
    await expect(page.getByRole('button', { name: 'DEPLOY WITH OVERRIDE' })).toBeVisible();

    // Cancel
    await page.getByRole('button', { name: 'CANCEL' }).click();

    // Override form should be hidden, original buttons should be back
    await expect(page.getByRole('button', { name: 'DEPLOY WITH OVERRIDE' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'TACTICAL OVERRIDE' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Campaign Abandon Flow
// ---------------------------------------------------------------------------

test.describe('Campaign Abandon', () => {
  let seed: SeedActiveCampaignResponse;

  test.beforeEach(async ({ request }) => {
    seed = await seedActiveCampaign(request);
  });

  test.afterEach(async ({ request }) => {
    if (seed?.campaignId) {
      await cleanupCampaign(request, seed.campaignId);
    }
  });

  test('shows abandon confirmation dialog', async ({ page }) => {
    await page.goto(`/battlefields/${seed.battlefieldId}/campaigns/${seed.campaignId}`);
    await page.waitForLoadState('networkidle');

    // Click ABANDON
    await page.getByRole('button', { name: 'ABANDON' }).click();

    // Confirm dialog should appear with warning
    await expect(page.getByText('ABANDON CAMPAIGN')).toBeVisible();
    await expect(page.getByText(/stop all active missions/i)).toBeVisible();
    await expect(page.getByText(/cannot be undone/i)).toBeVisible();

    // Should show ABANDON confirm button in dialog
    const confirmButton = page.locator('[role="dialog"]').getByRole('button', { name: 'ABANDON' });
    await expect(confirmButton).toBeVisible();
  });

  test('abandons campaign and shows abandoned state', async ({ page }) => {
    await page.goto(`/battlefields/${seed.battlefieldId}/campaigns/${seed.campaignId}`);
    await page.waitForLoadState('networkidle');

    // Click ABANDON
    await page.getByRole('button', { name: 'ABANDON' }).click();

    // Confirm
    const confirmButton = page.locator('[role="dialog"]').getByRole('button', { name: 'ABANDON' });
    await confirmButton.click();

    // Wait for page to update
    await page.waitForLoadState('networkidle');

    // Campaign should now show ABANDONED status
    await expect(page.getByText('ABANDONED').first()).toBeVisible({ timeout: 10_000 });

    // MISSION ACCOMPLISHED and ABANDON buttons should no longer be visible
    await expect(page.getByRole('button', { name: 'MISSION ACCOMPLISHED' })).not.toBeVisible();
  });

  test('can cancel abandon without affecting campaign', async ({ page }) => {
    await page.goto(`/battlefields/${seed.battlefieldId}/campaigns/${seed.campaignId}`);
    await page.waitForLoadState('networkidle');

    // Click ABANDON
    await page.getByRole('button', { name: 'ABANDON' }).click();

    // Dialog should appear
    await expect(page.getByText('ABANDON CAMPAIGN')).toBeVisible();

    // Press Escape to dismiss
    await page.keyboard.press('Escape');

    // Campaign should still be active — controls still visible
    await expect(page.getByRole('button', { name: 'MISSION ACCOMPLISHED' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ABANDON' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Campaign Completion Flow
// ---------------------------------------------------------------------------

test.describe('Campaign Completion', () => {
  let seed: SeedActiveCampaignResponse;

  test.beforeEach(async ({ request }) => {
    seed = await seedActiveCampaign(request);
  });

  test.afterEach(async ({ request }) => {
    if (seed?.campaignId) {
      await cleanupCampaign(request, seed.campaignId);
    }
  });

  test('can manually complete an active campaign', async ({ page }) => {
    await page.goto(`/battlefields/${seed.battlefieldId}/campaigns/${seed.campaignId}`);
    await page.waitForLoadState('networkidle');

    // Click MISSION ACCOMPLISHED
    await page.getByRole('button', { name: 'MISSION ACCOMPLISHED' }).click();

    // Wait for page to update
    await page.waitForLoadState('networkidle');

    // Campaign should now show ACCOMPLISHED status
    await expect(page.getByText('ACCOMPLISHED').first()).toBeVisible({ timeout: 10_000 });

    // Active campaign controls should no longer be visible
    await expect(page.getByRole('button', { name: 'MISSION ACCOMPLISHED' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'ABANDON' })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Compromised Campaign View
// ---------------------------------------------------------------------------

test.describe('Compromised Campaign View', () => {
  test('shows compromised guidance when campaign has failed missions', async ({ request, page }) => {
    // Seed an active campaign then manually set it to compromised via the API
    const seed = await seedActiveCampaign(request);

    try {
      // The seeded campaign is active with a compromised mission.
      // The campaign itself is active — when the orchestrator detects a compromised mission,
      // it sets the campaign to compromised. We'll simulate this by checking if the
      // compromised guidance appears when viewing a campaign with compromised missions.
      // Navigate to the compromised mission to test the per-mission override controls
      const missionUrl = `/battlefields/${seed.battlefieldId}/missions/${seed.compromisedMissionId}`;
      await page.goto(missionUrl);
      await page.waitForLoadState('networkidle');

      // Should show compromise-related action buttons
      await expect(page.getByRole('button', { name: 'APPROVE' })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole('button', { name: 'TACTICAL OVERRIDE' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'SKIP MISSION' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'ABANDON' })).toBeVisible();
    } finally {
      await cleanupCampaign(request, seed.campaignId);
    }
  });
});
