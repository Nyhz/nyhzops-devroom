import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock db module — routes import it but we only test the env guard (early return before DB access)
vi.mock('@/lib/db/index', () => ({
  getDatabase: () => ({}),
}));

describe('test seed API route E2E_TEST_MODE guard', () => {
  beforeEach(() => {
    vi.stubEnv('E2E_TEST_MODE', '');
    // Routes block in production before checking E2E_TEST_MODE. When the test
    // suite is spawned from the prod devroom service (in-app RUN TESTS),
    // NODE_ENV=production is inherited and these tests would assert the wrong
    // error message. Force a non-prod env so the E2E_TEST_MODE guard is hit.
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('POST /api/test/seed-campaign', () => {
    it('returns 403 when E2E_TEST_MODE is not set', async () => {
      const { POST } = await import('@/app/api/test/seed-campaign/route');
      const response = await POST();
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe('E2E_TEST_MODE not enabled');
    });
  });

  describe('DELETE /api/test/seed-campaign', () => {
    it('returns 403 when E2E_TEST_MODE is not set', async () => {
      const { DELETE } = await import('@/app/api/test/seed-campaign/route');
      const request = new Request('http://localhost/api/test/seed-campaign?campaignId=test123', {
        method: 'DELETE',
      });
      const response = await DELETE(request);
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe('E2E_TEST_MODE not enabled');
    });
  });

  describe('POST /api/test/seed-active-campaign', () => {
    it('returns 403 when E2E_TEST_MODE is not set', async () => {
      const { POST } = await import('@/app/api/test/seed-active-campaign/route');
      const response = await POST();
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe('E2E_TEST_MODE not enabled');
    });
  });

  describe('POST /api/test-fixtures', () => {
    it('returns 403 when E2E_TEST_MODE is not set', async () => {
      const { POST } = await import('@/app/api/test-fixtures/route');
      const request = new Request('http://localhost/api/test-fixtures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get-battlefield' }),
      });
      const response = await POST(request);
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe('E2E_TEST_MODE not enabled');
    });
  });
});
