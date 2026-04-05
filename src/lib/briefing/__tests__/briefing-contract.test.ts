import { describe, it, expect } from 'vitest';
import {
  BRIEFING_CONTRACT,
  GENERATE_PLAN_CONTRACT,
  SEED_CONTRACT_SUMMARY,
  CLAUDE_MD_CAP,
  SPEC_MD_CAP,
} from '../briefing-contract';

describe('briefing-contract', () => {
  describe('BRIEFING_CONTRACT', () => {
    it('describes both mission types', () => {
      expect(BRIEFING_CONTRACT).toContain('direct_action');
      expect(BRIEFING_CONTRACT).toContain('verification');
    });

    it('includes all JSON schema keys STRATEGIST must emit', () => {
      expect(BRIEFING_CONTRACT).toContain('summary');
      expect(BRIEFING_CONTRACT).toContain('phases');
      expect(BRIEFING_CONTRACT).toContain('missions');
      expect(BRIEFING_CONTRACT).toContain('assetCodename');
      expect(BRIEFING_CONTRACT).toContain('dependsOn');
      expect(BRIEFING_CONTRACT).toContain('priority');
      expect(BRIEFING_CONTRACT).toContain('type');
    });

    it('states the conversation rule (stop and wait)', () => {
      expect(BRIEFING_CONTRACT.toLowerCase()).toContain('wait');
    });

    it('forbids markdown code fences inside briefing strings', () => {
      expect(BRIEFING_CONTRACT).toMatch(/no.*code fence/i);
    });
  });

  describe('GENERATE_PLAN_CONTRACT', () => {
    it('demands raw JSON only', () => {
      expect(GENERATE_PLAN_CONTRACT).toMatch(/raw json/i);
    });

    it('includes the JSON schema', () => {
      expect(GENERATE_PLAN_CONTRACT).toContain('summary');
      expect(GENERATE_PLAN_CONTRACT).toContain('phases');
      expect(GENERATE_PLAN_CONTRACT).toContain('assetCodename');
    });

    it('defines both mission types', () => {
      expect(GENERATE_PLAN_CONTRACT).toContain('direct_action');
      expect(GENERATE_PLAN_CONTRACT).toContain('verification');
    });
  });

  describe('SEED_CONTRACT_SUMMARY', () => {
    it('is short enough for a seed stub (<1000 chars)', () => {
      expect(SEED_CONTRACT_SUMMARY.length).toBeLessThan(1000);
    });

    it('notes that the full contract is supplied at runtime', () => {
      expect(SEED_CONTRACT_SUMMARY.toLowerCase()).toContain('runtime');
    });

    it('identifies STRATEGIST', () => {
      expect(SEED_CONTRACT_SUMMARY).toContain('STRATEGIST');
    });
  });

  describe('truncation caps', () => {
    it('pins CLAUDE_MD_CAP to exactly 4000 characters', () => {
      expect(CLAUDE_MD_CAP).toBe(4000);
    });

    it('pins SPEC_MD_CAP to exactly 4000 characters', () => {
      expect(SPEC_MD_CAP).toBe(4000);
    });
  });
});
