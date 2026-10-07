import { describe, expect, it } from 'vitest';
import { chatLabel, chatName, chatTime, dropdownChats, groupChats } from '../client/src/chat/chatLabels';
import type { ChatRecord } from '../shared/types';

// Local-time dates, so the tests pass in any timezone.
const at = (y: number, mo: number, d: number, h = 9, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString();
const now = new Date(2026, 9, 7, 12, 0); // Wed Oct 7 2026, noon
const rec = (id: string, title: string, createdAt: string): ChatRecord => ({ id, sessionId: null, title, createdAt, lastUsedAt: createdAt });

describe('chatName', () => {
  it('names the command buttons', () => {
    expect(chatName('/gm')).toBe('Morning briefing');
    expect(chatName('/triage')).toBe('Inbox triage');
    expect(chatName('/my-tasks overdue')).toBe('Overdue tasks');
    expect(chatName('/enrich stale')).toBe('Stale contacts');
  });
  it('keeps the detail of other commands', () => {
    expect(chatName('/enrich Jane Smith')).toBe('Enrich: Jane Smith');
    expect(chatName('/my-tasks add "Board deck" --due 2026-10-09')).toBe('Tasks: add "Board deck" --due 2026-10-09');
  });
  it('leaves typed messages alone', () => {
    expect(chatName('Draft a reply to Jane about the offsite')).toBe('Draft a reply to Jane about the offsite');
    expect(chatName('/gmx')).toBe('/gmx');
    expect(chatName('  ')).toBe('New chat');
  });
});

describe('chatTime', () => {
  it('shows the time today and yesterday, the date otherwise', () => {
    expect(chatTime(at(2026, 10, 7, 8, 2), now)).toBe('8:02 AM');
    expect(chatTime(at(2026, 10, 7, 0, 5), now)).toBe('12:05 AM');
    expect(chatTime(at(2026, 10, 6, 15, 14), now)).toBe('Yesterday 3:14 PM');
    expect(chatTime(at(2026, 10, 5, 8, 10), now)).toBe('Mon, Oct 5');
    expect(chatTime(at(2025, 12, 31, 8, 10), now)).toBe('Wed, Dec 31, 2025');
  });
  it('handles a bad timestamp', () => {
    expect(chatTime('not a date', now)).toBe('');
  });
});

describe('chatLabel', () => {
  it('combines name and start time', () => {
    expect(chatLabel(rec('a', '/gm', at(2026, 10, 7, 8, 2)), now)).toBe('Morning briefing · 8:02 AM');
    expect(chatLabel(rec('a', '/gm', 'garbage'), now)).toBe('Morning briefing');
  });
});

describe('groupChats', () => {
  it('groups by start day, newest first, skipping empty groups', () => {
    const chats = [
      rec('old', '/gm', at(2026, 10, 1)),
      rec('t1', '/gm', at(2026, 10, 7, 8)),
      rec('y1', '/triage', at(2026, 10, 6, 9)),
      rec('t2', '/triage', at(2026, 10, 7, 11)),
    ];
    expect(groupChats(chats, now).map((g) => [g.group, g.chats.map((c) => c.id)])).toEqual([
      ['Today', ['t2', 't1']],
      ['Yesterday', ['y1']],
      ['Earlier', ['old']],
    ]);
    expect(groupChats([rec('t', '/gm', at(2026, 10, 7))], now).map((g) => g.group)).toEqual(['Today']);
  });
});

describe('dropdownChats', () => {
  const many = Array.from({ length: 20 }, (_, i) => rec(`c${i}`, '/gm', at(2026, 9, 1 + i)));
  it('keeps the newest N', () => {
    const shown = dropdownChats(many, null, 15);
    expect(shown).toHaveLength(15);
    expect(shown[0].id).toBe('c19');
    expect(shown.some((c) => c.id === 'c0')).toBe(false);
  });
  it('always includes the open chat, even if it is older', () => {
    const shown = dropdownChats(many, 'c0', 15);
    expect(shown).toHaveLength(16);
    expect(shown.at(-1)?.id).toBe('c0');
  });
  it('does not duplicate an open chat that is already in the newest N', () => {
    expect(dropdownChats(many, 'c19', 15)).toHaveLength(15);
  });
});
