import { describe, it, expect } from 'vitest';
import {
  phaseId,
  missionId,
  parseMissionId,
  parsePhaseId,
  PRIORITIES,
  priorityDotColor,
} from '../plan-editor/plan-editor-utils';

describe('plan-editor-utils', () => {
  describe('phaseId', () => {
    it('encodes index into phase drag ID', () => {
      expect(phaseId(0)).toBe('phase-0');
      expect(phaseId(5)).toBe('phase-5');
      expect(phaseId(42)).toBe('phase-42');
    });
  });

  describe('missionId', () => {
    it('encodes phase and mission indices into drag ID', () => {
      expect(missionId(0, 0)).toBe('mission-0-0');
      expect(missionId(2, 3)).toBe('mission-2-3');
      expect(missionId(10, 99)).toBe('mission-10-99');
    });
  });

  describe('parsePhaseId', () => {
    it('extracts index from valid phase ID', () => {
      expect(parsePhaseId('phase-0')).toBe(0);
      expect(parsePhaseId('phase-7')).toBe(7);
    });

    it('returns null for invalid phase ID', () => {
      expect(parsePhaseId('mission-0-0')).toBeNull();
      expect(parsePhaseId('phase-')).toBeNull();
      expect(parsePhaseId('phase-abc')).toBeNull();
      expect(parsePhaseId('')).toBeNull();
      expect(parsePhaseId('something')).toBeNull();
    });
  });

  describe('parseMissionId', () => {
    it('extracts phase and mission indices from valid mission ID', () => {
      expect(parseMissionId('mission-0-0')).toEqual({ phaseIndex: 0, missionIndex: 0 });
      expect(parseMissionId('mission-3-7')).toEqual({ phaseIndex: 3, missionIndex: 7 });
    });

    it('returns null for invalid mission ID', () => {
      expect(parseMissionId('phase-0')).toBeNull();
      expect(parseMissionId('mission-0')).toBeNull();
      expect(parseMissionId('mission--0')).toBeNull();
      expect(parseMissionId('mission-abc-0')).toBeNull();
      expect(parseMissionId('')).toBeNull();
    });
  });

  describe('roundtrip encoding/parsing', () => {
    it('phaseId → parsePhaseId roundtrips', () => {
      for (const i of [0, 1, 5, 99]) {
        expect(parsePhaseId(phaseId(i))).toBe(i);
      }
    });

    it('missionId → parseMissionId roundtrips', () => {
      for (const [pi, mi] of [[0, 0], [2, 3], [10, 99]]) {
        expect(parseMissionId(missionId(pi, mi))).toEqual({ phaseIndex: pi, missionIndex: mi });
      }
    });
  });

  describe('PRIORITIES', () => {
    it('contains all four priority levels in order', () => {
      expect(PRIORITIES).toEqual(['low', 'routine', 'high', 'critical']);
    });
  });

  describe('priorityDotColor', () => {
    it('maps every priority to a color class', () => {
      expect(priorityDotColor['low']).toBe('bg-dr-dim');
      expect(priorityDotColor['routine']).toBe('bg-dr-muted');
      expect(priorityDotColor['high']).toBe('bg-dr-amber');
      expect(priorityDotColor['critical']).toBe('bg-dr-red');
    });

    it('has entries for all PRIORITIES', () => {
      for (const p of PRIORITIES) {
        expect(priorityDotColor[p]).toBeDefined();
      }
    });
  });
});
