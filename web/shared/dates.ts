export type Bucket = 'overdue' | 'today' | 'week' | 'later' | 'done';

export const CADENCE_DAYS: Record<number, number> = { 1: 14, 2: 30, 3: 60 };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function localToday(now: Date = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function bucketTask(task: { status?: string; due_date?: string }, today: string): Bucket {
  if (task.status === 'complete') return 'done';
  if (!task.due_date || !ISO_DATE.test(task.due_date)) return 'later';
  const days = daysBetween(today, task.due_date);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  return days <= 7 ? 'week' : 'later';
}

export function staleness(tier: number | null, lastInteraction: string | null, today: string): { daysSince: number | null; stale: boolean } {
  const cadence = tier === null ? undefined : CADENCE_DAYS[tier];
  if (!lastInteraction || !ISO_DATE.test(lastInteraction)) return { daysSince: null, stale: cadence !== undefined };
  const daysSince = daysBetween(lastInteraction, today);
  return { daysSince, stale: cadence !== undefined && daysSince > cadence };
}
