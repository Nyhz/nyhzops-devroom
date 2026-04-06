export const SCHEDULE_TASK_TYPES = [
  'maintenance',
  'health',
  'reporting',
  'sync',
] as const;

export type ScheduleTaskType = (typeof SCHEDULE_TASK_TYPES)[number];

export interface ScheduleTaskDossier {
  id: string;
  name: string;
  type: ScheduleTaskType;
  description: string;
  defaultCron: string;
}

export const SCHEDULE_DOSSIERS: readonly ScheduleTaskDossier[] = [
  {
    id: 'worktree-sweep',
    name: 'WORKTREE SWEEP',
    type: 'maintenance',
    description:
      'Cleans orphaned worktrees from completed, failed, or abandoned missions. ' +
      'Compares existing worktrees against active mission IDs and removes any ' +
      'that no longer have a running mission.',
    defaultCron: '0 3 * * *',
  },
  {
    id: 'branch-sweep',
    name: 'BRANCH SWEEP',
    type: 'maintenance',
    description:
      'Removes local branches already merged into main and local branches with ' +
      'no commits in 7+ days. Prunes remote tracking refs for deleted upstream ' +
      'branches (git fetch --prune).',
    defaultCron: '0 3 * * *',
  },
  {
    id: 'activity-digest',
    name: 'ACTIVITY DIGEST',
    type: 'reporting',
    description:
      'Generates a summary of recent battlefield activity — missions launched, ' +
      'success/failure rates, campaigns completed, and open intel notes. Report ' +
      'window automatically matches your schedule interval, computed from the ' +
      'previous execution time.',
    defaultCron: '0 8 * * 1',
  },
] as const;

export function getScheduleDossier(id: string): ScheduleTaskDossier | undefined {
  return SCHEDULE_DOSSIERS.find((d) => d.id === id);
}

export function getDossiersByType(type: ScheduleTaskType): ScheduleTaskDossier[] {
  return SCHEDULE_DOSSIERS.filter((d) => d.type === type);
}
