import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock db module — routes import it but we only test the env guard (early return before DB access)
vi.mock('@/lib/db/index', () => ({
  getDatabase: () => ({}),
}));

describe('test seed API route E2E_TEST_MODE guard', () => {
  const originalEnv = process.env.E2E_TEST_MODE;

  beforeEach(() => {
    delete process.env.E2E_TEST_MODE;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.E2E_TEST_MODE = originalEnv;
    } else {
      delete process.env.E2E_TEST_MODE;
    }
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
