import { CronExpressionParser } from 'cron-parser';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Compute the next run time (unix ms) from a cron expression.
 */
export function getNextRun(cronExpression: string): number {
  const interval = CronExpressionParser.parse(cronExpression);
  return interval.next().getTime();
}

/**
 * Validate whether a string is a valid cron expression.
 */
export function validateCron(cron: string): boolean {
  try {
    CronExpressionParser.parse(cron);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a cron expression to a human-readable string.
 * Handles common patterns; falls back to raw cron for complex ones.
 */
export function formatCronHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Every N minutes: "*/5 * * * *"
  if (minute.startsWith('*/') && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const n = parseInt(minute.slice(2), 10);
    if (n === 1) return 'Every minute';
    return `Every ${n} minutes`;
  }

  // Every hour: "0 * * * *"
  if (minute === '0' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Every hour';
  }

  // Every N hours: "0 */N * * *"
  if (minute === '0' && hour.startsWith('*/') && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const n = parseInt(hour.slice(2), 10);
    return `Every ${n} hours`;
  }

  // At specific minute every hour: "30 * * * *"
  if (/^\d+$/.test(minute) && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Every hour at :${minute.padStart(2, '0')}`;
  }

  // Daily at specific time: "M H * * *"
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Every day at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  }

  // Weekly on specific day: "M H * * D"
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dayOfMonth === '*' && month === '*' && /^\d+$/.test(dayOfWeek)) {
    const dow = parseInt(dayOfWeek, 10);
    const dayName = DAY_NAMES[dow] || dayOfWeek;
    return `Every ${dayName} at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  }

  // Monthly on specific day: "M H D * *"
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && /^\d+$/.test(dayOfMonth) && month === '*' && dayOfWeek === '*') {
    const dom = parseInt(dayOfMonth, 10);
    const suffix = dom === 1 ? 'st' : dom === 2 ? 'nd' : dom === 3 ? 'rd' : 'th';
    return `${dom}${suffix} of every month at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  }

  // Fallback: raw cron
  return cron;
}
