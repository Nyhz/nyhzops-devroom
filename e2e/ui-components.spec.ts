import { test, expect } from '@playwright/test';

const HARNESS_URL = '/test-harness';

/**
 * Selector scoped to the test harness content area (excludes sidebar).
 * base-ui may render duplicate elements via portals; scoping prevents strict mode violations.
 */
const HARNESS = '[data-testid="test-harness"]';

test.describe('UI Components E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Bypass War Room boot gate
    await page.addInitScript(() => {
      sessionStorage.setItem('devroom-booted', 'true');
    });
    await page.goto(HARNESS_URL);
    await page.waitForSelector(HARNESS, { timeout: 15_000 });
    // Wait for React hydration to settle (dev mode strict effects double-mount)
    await page.waitForLoadState('networkidle');
  });

  // ─── TacTextareaWithImages ───────────────────────────────────────────

  test.describe('TacTextareaWithImages', () => {
    test('accepts text input', async ({ page }) => {
      const section = page.getByTestId('section-textarea');
      const textarea = section.locator('textarea').first();
      await textarea.fill('Hello Commander');
      await expect(section.getByTestId('textarea-output')).toHaveText('Hello Commander');
    });

    test('shows paste/drop hint', async ({ page }) => {
      const section = page.getByTestId('section-textarea');
      await expect(section.getByText('Paste or drop images')).toBeVisible();
    });

    test('handles image paste from clipboard', async ({ page }) => {
      const section = page.getByTestId('section-textarea');
      const textarea = section.locator('textarea').first();
      await textarea.focus();

      // Create a small 1x1 red PNG and dispatch paste event
      await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'red';
        ctx.fillRect(0, 0, 1, 1);
        const blob = await new Promise<Blob>((resolve) =>
          canvas.toBlob((b) => resolve(b!), 'image/png'),
        );
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(new File([blob], 'test.png', { type: 'image/png' }));
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dataTransfer,
        });
        document.querySelector('[data-testid="section-textarea"] textarea')!.dispatchEvent(pasteEvent);
        await new Promise((r) => setTimeout(r, 500));
      });

      // The textarea output should contain a markdown image with base64 data
      await expect(section.getByTestId('textarea-output')).toContainText(
        '![screenshot](data:image/png;base64,',
        { timeout: 5_000 },
      );

      // "Image added" confirmation should appear
      await expect(section.getByText('Image added')).toBeVisible();
    });

    test('handles image drag-and-drop', async ({ page }) => {
      const section = page.getByTestId('section-textarea');

      await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'blue';
        ctx.fillRect(0, 0, 1, 1);
        const blob = await new Promise<Blob>((resolve) =>
          canvas.toBlob((b) => resolve(b!), 'image/png'),
        );
        const file = new File([blob], 'drop.png', { type: 'image/png' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        const target = document.querySelector('[data-testid="section-textarea"] textarea')!;

        target.dispatchEvent(
          new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }),
        );
        target.dispatchEvent(
          new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }),
        );

        await new Promise((r) => setTimeout(r, 500));
      });

      await expect(section.getByTestId('textarea-output')).toContainText(
        '![screenshot](data:image/png;base64,',
        { timeout: 5_000 },
      );
    });

    test('image paste inserts at cursor position', async ({ page }) => {
      const section = page.getByTestId('section-textarea');
      const textarea = section.locator('textarea').first();

      // Type some text first
      await textarea.fill('before after');

      // Position cursor between "before " and "after"
      await textarea.focus();
      await page.evaluate(() => {
        const el = document.querySelector(
          '[data-testid="section-textarea"] textarea',
        ) as HTMLTextAreaElement;
        el.selectionStart = 7;
        el.selectionEnd = 7;
      });

      // Paste an image
      await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'green';
        ctx.fillRect(0, 0, 1, 1);
        const blob = await new Promise<Blob>((resolve) =>
          canvas.toBlob((b) => resolve(b!), 'image/png'),
        );
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(new File([blob], 'test.png', { type: 'image/png' }));
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dataTransfer,
        });
        document.querySelector('[data-testid="section-textarea"] textarea')!.dispatchEvent(pasteEvent);
        await new Promise((r) => setTimeout(r, 500));
      });

      const text = await section.getByTestId('textarea-output').textContent();
      // The image markdown should be inserted between "before " and "after"
      expect(text).toMatch(/^before !\[screenshot\]\(data:image\/png;base64,.+\)after$/);
    });

    test('image removal by clearing text', async ({ page }) => {
      const section = page.getByTestId('section-textarea');
      const textarea = section.locator('textarea').first();

      // Paste an image first
      await textarea.focus();
      await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'red';
        ctx.fillRect(0, 0, 1, 1);
        const blob = await new Promise<Blob>((resolve) =>
          canvas.toBlob((b) => resolve(b!), 'image/png'),
        );
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(new File([blob], 'test.png', { type: 'image/png' }));
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dataTransfer,
        });
        document.querySelector('[data-testid="section-textarea"] textarea')!.dispatchEvent(pasteEvent);
        await new Promise((r) => setTimeout(r, 500));
      });

      // Verify image was added
      await expect(section.getByTestId('textarea-output')).toContainText('![screenshot]', {
        timeout: 5_000,
      });

      // Clear the textarea
      await textarea.fill('');
      await expect(section.getByTestId('textarea-output')).toHaveText('');
    });
  });

  // ─── TacSelect ───────────────────────────────────────────────────────

  test.describe('TacSelect', () => {
    test('renders trigger with placeholder', async ({ page }) => {
      const section = page.getByTestId('section-select');
      const trigger = section.getByRole('combobox');
      await expect(trigger).toBeVisible();
      await expect(trigger).toContainText('Choose an asset...');
    });

    test('opens dropdown on click and shows options', async ({ page }) => {
      const section = page.getByTestId('section-select');
      const trigger = section.getByRole('combobox');
      await trigger.click();

      // All options should be visible in the dropdown
      await expect(page.getByRole('option', { name: 'Recon' })).toBeVisible({ timeout: 5_000 });
      await expect(page.getByRole('option', { name: 'Engineer' })).toBeVisible();
      await expect(page.getByRole('option', { name: 'Medic' })).toBeVisible();
      await expect(page.getByRole('option', { name: 'Sniper' })).toBeVisible();
    });

    test('selects an option on click', async ({ page }) => {
      const section = page.getByTestId('section-select');
      const trigger = section.getByRole('combobox');
      await trigger.click();

      await page.getByRole('option', { name: 'Engineer' }).click();

      // Trigger should now show the selected value (base-ui renders item text)
      await expect(trigger).toContainText(/engineer/i);
      // Output should reflect the selection
      await expect(section.getByTestId('select-output')).toHaveText('engineer');
    });

    test('keyboard navigation: arrow keys and Enter', async ({ page }) => {
      const section = page.getByTestId('section-select');
      const trigger = section.getByRole('combobox');

      // Focus and open with keyboard
      await trigger.focus();
      await page.keyboard.press('Enter');

      // Wait for dropdown
      await expect(page.getByRole('option', { name: 'Recon' })).toBeVisible({ timeout: 5_000 });

      // Navigate down with arrow keys
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');

      // Select with Enter
      await page.keyboard.press('Enter');

      // The output should show a selected value
      const output = await section.getByTestId('select-output').textContent();
      expect(output).not.toBe('(none selected)');
    });

    test('closes dropdown on Escape', async ({ page }) => {
      const section = page.getByTestId('section-select');
      const trigger = section.getByRole('combobox');
      await trigger.click();

      await expect(page.getByRole('option', { name: 'Recon' })).toBeVisible({ timeout: 5_000 });

      await page.keyboard.press('Escape');

      // Options should no longer be visible
      await expect(page.getByRole('option', { name: 'Recon' })).not.toBeVisible({ timeout: 5_000 });
    });

    test('changes selection after initial select', async ({ page }) => {
      const section = page.getByTestId('section-select');
      const trigger = section.getByRole('combobox');

      // Select first option
      await trigger.click();
      await page.getByRole('option', { name: 'Recon' }).click();
      await expect(section.getByTestId('select-output')).toHaveText('recon');

      // Change to another option
      await trigger.click();
      await page.getByRole('option', { name: 'Sniper' }).click();
      await expect(section.getByTestId('select-output')).toHaveText('sniper');
    });
  });

  // ─── TacModal ────────────────────────────────────────────────────────

  test.describe('TacModal', () => {
    test('opens modal on trigger click', async ({ page }) => {
      const section = page.getByTestId('section-modal');
      await section.getByRole('button', { name: 'Open Modal' }).click();
      await expect(page.getByTestId('modal-body')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByText('Mission Briefing')).toBeVisible();
      await expect(page.getByText('Review the mission parameters before deployment.')).toBeVisible();
    });

    test('closes modal on Escape key', async ({ page }) => {
      const section = page.getByTestId('section-modal');
      await section.getByRole('button', { name: 'Open Modal' }).click();
      await expect(page.getByTestId('modal-body')).toBeVisible({ timeout: 5_000 });

      await page.keyboard.press('Escape');
      await expect(page.getByTestId('modal-body')).not.toBeVisible({ timeout: 5_000 });
    });

    test('closes modal on overlay click', async ({ page }) => {
      const section = page.getByTestId('section-modal');
      await section.getByRole('button', { name: 'Open Modal' }).click();
      await expect(page.getByTestId('modal-body')).toBeVisible({ timeout: 5_000 });

      // Click the overlay (backdrop) — it's behind the modal content
      const overlay = page.locator('[data-slot="dialog-overlay"]');
      await overlay.click({ position: { x: 10, y: 10 }, force: true });

      await expect(page.getByTestId('modal-body')).not.toBeVisible({ timeout: 5_000 });
    });

    test('closes modal via Cancel button', async ({ page }) => {
      const section = page.getByTestId('section-modal');
      await section.getByRole('button', { name: 'Open Modal' }).click();
      await expect(page.getByTestId('modal-body')).toBeVisible({ timeout: 5_000 });

      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByTestId('modal-body')).not.toBeVisible({ timeout: 5_000 });
    });

    test('closes modal via Confirm button', async ({ page }) => {
      const section = page.getByTestId('section-modal');
      await section.getByRole('button', { name: 'Open Modal' }).click();
      await expect(page.getByTestId('modal-body')).toBeVisible({ timeout: 5_000 });

      await page.getByRole('button', { name: 'Confirm' }).click();
      await expect(page.getByTestId('modal-body')).not.toBeVisible({ timeout: 5_000 });
    });

    test('renders header, body, and footer', async ({ page }) => {
      const section = page.getByTestId('section-modal');
      await section.getByRole('button', { name: 'Open Modal' }).click();
      await expect(page.getByTestId('modal-body')).toBeVisible({ timeout: 5_000 });

      // Header
      await expect(page.getByText('Mission Briefing')).toBeVisible();
      // Description
      await expect(page.getByText('Review the mission parameters before deployment.')).toBeVisible();
      // Body
      await expect(page.getByText('This is the modal body content for testing.')).toBeVisible();
      // Footer buttons
      await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Confirm' })).toBeVisible();
    });

    test('modal can be reopened after closing', async ({ page }) => {
      const section = page.getByTestId('section-modal');

      // Open
      await section.getByRole('button', { name: 'Open Modal' }).click();
      await expect(page.getByTestId('modal-body')).toBeVisible({ timeout: 5_000 });

      // Close
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('modal-body')).not.toBeVisible({ timeout: 5_000 });

      // Reopen
      await section.getByRole('button', { name: 'Open Modal' }).click();
      await expect(page.getByTestId('modal-body')).toBeVisible({ timeout: 5_000 });
    });
  });
});
