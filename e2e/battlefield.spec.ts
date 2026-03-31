import { test, expect } from './fixtures';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * E2E: Create Battlefield Flow
 *
 * Tests the full lifecycle:
 *  1. Navigate to battlefields page
 *  2. Click "+ NEW BATTLEFIELD"
 *  3. Fill in and submit the creation form
 *  4. Verify redirect and battlefield detail page
 *  5. Verify battlefield appears in HQ list
 *  6. Cleanup via delete
 */

let tempRepoPath: string;

test.beforeAll(() => {
  // Create a temp git repo for "link existing repo" tests
  tempRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'devroom-e2e-'));
  execSync('git init && git commit --allow-empty -m "init"', {
    cwd: tempRepoPath,
    stdio: 'ignore',
  });
});

test.afterAll(() => {
  // Clean up temp repo
  if (tempRepoPath && fs.existsSync(tempRepoPath)) {
    fs.rmSync(tempRepoPath, { recursive: true, force: true });
  }
});

test.beforeEach(async ({ page }) => {
  // Bypass the War Room boot animation
  await page.addInitScript(() => {
    sessionStorage.setItem('devroom-booted', 'true');
  });
});

// ---------------------------------------------------------------------------
// Helper: delete a battlefield via its config page
// ---------------------------------------------------------------------------
async function deleteBattlefieldViaUI(
  page: import('@playwright/test').Page,
  battlefieldId: string,
) {
  await page.goto(`/battlefields/${battlefieldId}/config`);
  await page.waitForLoadState('networkidle');

  // Look for the delete button on the config page
  const deleteButton = page.getByRole('button', { name: /delete/i });
  if (await deleteButton.isVisible().catch(() => false)) {
    await deleteButton.click();

    // Confirm dialog if one appears
    const confirmButton = page.getByRole('button', { name: /confirm|delete|yes/i });
    if (await confirmButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await confirmButton.click();
    }

    await page.waitForURL('/', { timeout: 10_000 }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Create Battlefield Flow', () => {
  test.describe('Form Validation', () => {
    test('shows error when submitting with empty name', async ({ appPage: page }) => {
      await page.goto('/battlefields/new');
      await page.waitForLoadState('networkidle');

      // Click submit without filling anything
      await page.getByRole('button', { name: 'CREATE BATTLEFIELD' }).click();

      // Should show validation error
      await expect(page.getByText('Name is required.')).toBeVisible();
    });

    test('shows error when linking repo without path', async ({ appPage: page }) => {
      await page.goto('/battlefields/new');
      await page.waitForLoadState('networkidle');

      // Switch to link mode
      await page.getByText('[Link existing repo]').click();

      // Fill name but not repo path
      await page.getByPlaceholder('Project name').fill('Test No Path');

      // Submit
      await page.getByRole('button', { name: 'CREATE BATTLEFIELD' }).click();

      // Should show repo path error
      await expect(
        page.getByText('Repo path is required when linking an existing repository.'),
      ).toBeVisible();
    });
  });

  test.describe('Link Existing Repo', () => {
    let createdBattlefieldId: string | null = null;

    test.afterEach(async ({ page }) => {
      // Cleanup: delete the battlefield if it was created
      if (createdBattlefieldId) {
        await deleteBattlefieldViaUI(page, createdBattlefieldId);
        createdBattlefieldId = null;
      }
    });

    test('creates battlefield by linking existing repo with skip bootstrap', async ({
      appPage: page,
    }) => {
      // 1. Navigate to HQ
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // 2. Click "+ NEW BATTLEFIELD"
      await page.getByRole('link', { name: /NEW BATTLEFIELD/i }).first().click();
      await page.waitForURL('/battlefields/new');

      // 3. Switch to link mode
      await page.getByText('[Link existing repo]').click();

      // 4. Fill the form
      await page.getByPlaceholder('Project name').fill('E2E Link Test');
      await page.getByPlaceholder('/absolute/path/to/existing/repo').fill(tempRepoPath);

      // Verify codename auto-generated
      const codenameInput = page.getByPlaceholder('OPERATION THUNDER');
      await expect(codenameInput).toHaveValue('OPERATION E2E LINK TEST');

      // Skip bootstrap to get active status immediately
      await page.getByText("Skip bootstrap — I'll provide my own CLAUDE.md").click();

      // 5. Submit
      await page.getByRole('button', { name: 'CREATE BATTLEFIELD' }).click();

      // 6. Verify redirect to battlefield detail page
      await page.waitForURL(/\/battlefields\/[A-Za-z0-9]+/, { timeout: 15_000 });
      const url = page.url();
      const match = url.match(/\/battlefields\/([A-Za-z0-9]+)/);
      expect(match).toBeTruthy();
      createdBattlefieldId = match![1];

      // 7. Verify we're on the battlefield page — should show the codename or missions page
      // With skipBootstrap + active status, we get the full missions view
      await expect(page.getByText('OPERATION E2E LINK TEST')).toBeVisible({ timeout: 10_000 });

      // 8. Navigate back to HQ and verify battlefield appears in the list
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('OPERATION E2E LINK TEST')).toBeVisible();
      await expect(page.getByText('E2E Link Test')).toBeVisible();
    });
  });

  test.describe('Link Existing Repo with Bootstrap', () => {
    let createdBattlefieldId: string | null = null;

    test.afterEach(async ({ page }) => {
      if (createdBattlefieldId) {
        await deleteBattlefieldViaUI(page, createdBattlefieldId);
        createdBattlefieldId = null;
      }
    });

    test('creates battlefield with initial briefing (initializing status)', async ({
      appPage: page,
    }) => {
      await page.goto('/battlefields/new');
      await page.waitForLoadState('networkidle');

      // Switch to link mode
      await page.getByText('[Link existing repo]').click();

      // Fill required fields
      await page.getByPlaceholder('Project name').fill('E2E Bootstrap Test');
      await page.getByPlaceholder('/absolute/path/to/existing/repo').fill(tempRepoPath);

      // Provide initial briefing (triggers bootstrap, status=initializing)
      await page
        .getByPlaceholder("Commander's project briefing for bootstrap...")
        .fill('Test briefing for E2E');

      // Submit
      await page.getByRole('button', { name: 'CREATE BATTLEFIELD' }).click();

      // Should redirect to the battlefield page
      await page.waitForURL(/\/battlefields\/[A-Za-z0-9]+/, { timeout: 15_000 });
      const url = page.url();
      const match = url.match(/\/battlefields\/([A-Za-z0-9]+)/);
      expect(match).toBeTruthy();
      createdBattlefieldId = match![1];

      // Battlefield is in initializing status — should show bootstrap-related content
      // Either "AWAITING BOOTSTRAP", bootstrap comms, or bootstrap review
      const content = page.locator('body');
      await expect(content).toContainText(/BOOTSTRAP|AWAITING|E2E BOOTSTRAP TEST/i, {
        timeout: 10_000,
      });
    });
  });

  test.describe('Codename Auto-generation', () => {
    test('auto-generates codename from name and allows manual override', async ({
      appPage: page,
    }) => {
      await page.goto('/battlefields/new');
      await page.waitForLoadState('networkidle');

      const nameInput = page.getByPlaceholder('Project name');
      const codenameInput = page.getByPlaceholder('OPERATION THUNDER');

      // Type a name — codename should auto-generate
      await nameInput.fill('Alpha Strike');
      await expect(codenameInput).toHaveValue('OPERATION ALPHA STRIKE');

      // Manually edit codename
      await codenameInput.fill('OPERATION CUSTOM');

      // Change name — codename should NOT update since it was manually edited
      await nameInput.fill('Beta Strike');
      await expect(codenameInput).toHaveValue('OPERATION CUSTOM');
    });
  });

  test.describe('Mode Toggle', () => {
    test('toggles between new and link modes', async ({ appPage: page }) => {
      await page.goto('/battlefields/new');
      await page.waitForLoadState('networkidle');

      // Default: new mode — should see scaffold command, no repo path
      await expect(page.getByPlaceholder('e.g. npx create-next-app . --typescript')).toBeVisible();
      await expect(
        page.getByPlaceholder('/absolute/path/to/existing/repo'),
      ).not.toBeVisible();

      // Switch to link mode
      await page.getByText('[Link existing repo]').click();

      // Should see repo path, no scaffold command
      await expect(page.getByPlaceholder('/absolute/path/to/existing/repo')).toBeVisible();
      await expect(
        page.getByPlaceholder('e.g. npx create-next-app . --typescript'),
      ).not.toBeVisible();

      // Toggle back
      await page.getByText('[Create new project]').click();

      // Should see scaffold command again
      await expect(page.getByPlaceholder('e.g. npx create-next-app . --typescript')).toBeVisible();
    });

    test('toggles skip bootstrap fields', async ({ appPage: page }) => {
      await page.goto('/battlefields/new');
      await page.waitForLoadState('networkidle');

      // Default: initial briefing visible, CLAUDE.MD PATH hidden
      await expect(
        page.getByPlaceholder("Commander's project briefing for bootstrap..."),
      ).toBeVisible();
      await expect(page.getByPlaceholder('Absolute path to CLAUDE.md')).not.toBeVisible();

      // Enable skip bootstrap
      await page.getByText("Skip bootstrap — I'll provide my own CLAUDE.md").click();

      // Initial briefing hidden, CLAUDE.MD PATH and SPEC.MD PATH visible
      await expect(
        page.getByPlaceholder("Commander's project briefing for bootstrap..."),
      ).not.toBeVisible();
      await expect(page.getByPlaceholder('Absolute path to CLAUDE.md')).toBeVisible();
      await expect(
        page.getByPlaceholder('Absolute path to SPEC.md (optional)'),
      ).toBeVisible();

      // Toggle back
      await page.getByText('← Generate docs automatically').click();

      // Initial briefing should reappear
      await expect(
        page.getByPlaceholder("Commander's project briefing for bootstrap..."),
      ).toBeVisible();
    });
  });
});
