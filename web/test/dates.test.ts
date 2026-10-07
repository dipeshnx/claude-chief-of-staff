import { describe, expect, it } from 'vitest';
import { bucketTask, daysBetween, localToday, staleness } from '../shared/dates';

describe('localToday', () => {
  it('uses local calendar date, not UTC', () => {
    expect(localToday(new Date(2026, 9, 6, 23, 30))).toBe('2026-10-06');
    expect(localToday(new Date(2026, 0, 2, 0, 5))).toBe('2026-01-02');
  });
});

describe('daysBetween', () => {
  it('counts whole days across DST and month ends', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-01-31', '2026-02-01')).toBe(1);
    expect(daysBetween('2026-02-01', '2026-01-31')).toBe(-1);
  });
});

describe('bucketTask', () => {
  const today = '2026-10-06';
  it('buckets by due date', () => {
    expect(bucketTask({ status: 'pending', due_date: '2026-10-05' }, today)).toBe('overdue');
    expect(bucketTask({ status: 'pending', due_date: '2026-10-06' }, today)).toBe('today');
    expect(bucketTask({ status: 'pending', due_date: '2026-10-13' }, today)).toBe('week');
    expect(bucketTask({ status: 'pending', due_date: '2026-10-14' }, today)).toBe('later');
  });
  it('treats completed, undated and malformed dates sensibly', () => {
    expect(bucketTask({ status: 'complete', due_date: '2020-01-01' }, today)).toBe('done');
    expect(bucketTask({ status: 'pending' }, today)).toBe('later');
    expect(bucketTask({ status: 'pending', due_date: 'next week' }, today)).toBe('later');
  });
});

describe('staleness', () => {
  const today = '2026-03-01';
  it('applies tier cadence 14/30/60', () => {
    expect(staleness(1, '2026-02-15', today)).toEqual({ daysSince: 14, stale: false });
    expect(staleness(1, '2026-02-14', today)).toEqual({ daysSince: 15, stale: true });
    expect(staleness(2, '2026-01-30', today)).toEqual({ daysSince: 30, stale: false });
    expect(staleness(3, '2025-12-01', today)).toEqual({ daysSince: 90, stale: true });
  });
  it('flags tiered contacts with no recorded interaction; never flags untiered ones', () => {
    expect(staleness(2, null, today)).toEqual({ daysSince: null, stale: true });
    expect(staleness(null, '2020-01-01', today)).toEqual({ daysSince: 2251, stale: false });
    expect(staleness(9, '2020-01-01', today).stale).toBe(false);
  });
});
