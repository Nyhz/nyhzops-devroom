import { describe, it, expect } from 'vitest';
import {
  SCHEDULE_DOSSIERS,
  getScheduleDossier,
  getDossiersByType,
  SCHEDULE_TASK_TYPES,
  type ScheduleTaskType,
  type ScheduleTaskDossier,
} from '../dossiers';

describe('SCHEDULE_DOSSIERS', () => {
  it('contains exactly 3 dossiers', () => {
    expect(SCHEDULE_DOSSIERS).toHaveLength(3);
  });

  it('has unique ids', () => {
    const ids = SCHEDULE_DOSSIERS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique names', () => {
    const names = SCHEDULE_DOSSIERS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every dossier has a valid type', () => {
    for (const d of SCHEDULE_DOSSIERS) {
      expect(SCHEDULE_TASK_TYPES).toContain(d.type);
    }
  });

  it('every dossier has a non-empty description', () => {
    for (const d of SCHEDULE_DOSSIERS) {
      expect(d.description.length).toBeGreaterThan(0);
    }
  });
});

describe('getScheduleDossier', () => {
  it('returns dossier by id', () => {
    const d = getScheduleDossier('worktree-sweep');
    expect(d).toBeDefined();
    expect(d!.name).toBe('WORKTREE SWEEP');
    expect(d!.type).toBe('maintenance');
  });

  it('returns undefined for unknown id', () => {
    expect(getScheduleDossier('nonexistent')).toBeUndefined();
  });
});

describe('getDossiersByType', () => {
  it('returns 2 maintenance dossiers', () => {
    const result = getDossiersByType('maintenance');
    expect(result).toHaveLength(2);
    expect(result.every((d) => d.type === 'maintenance')).toBe(true);
  });

  it('returns 1 reporting dossier', () => {
    const result = getDossiersByType('reporting');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('activity-digest');
  });

  it('returns empty array for types with no dossiers', () => {
    expect(getDossiersByType('health')).toEqual([]);
    expect(getDossiersByType('sync')).toEqual([]);
  });
});
