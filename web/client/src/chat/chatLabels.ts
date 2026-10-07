import type { ChatRecord } from '../../../shared/types';
import { localToday } from '../../../shared/dates';

/** How many chats the chat-pane dropdown lists; the Chats page lists all. */
export const DROPDOWN_LIMIT = 15;

const COMMAND_NAMES: Record<string, string> = {
  '/gm': 'Morning briefing',
  '/triage': 'Inbox triage',
  '/my-tasks overdue': 'Overdue tasks',
  '/enrich stale': 'Stale contacts',
};
const COMMAND_PREFIXES: [string, string][] = [
  ['/my-tasks ', 'Tasks'],
  ['/enrich ', 'Enrich'],
  ['/triage ', 'Triage'],
];

/** A chat's title is its first message; give the command buttons readable names. */
export function chatName(title: string): string {
  const t = title.trim();
  if (COMMAND_NAMES[t]) return COMMAND_NAMES[t];
  for (const [prefix, label] of COMMAND_PREFIXES) {
    if (t.startsWith(prefix)) return `${label}: ${t.slice(prefix.length).trim()}`;
  }
  return t || 'New chat';
}

export type DayGroup = 'Today' | 'Yesterday' | 'Earlier';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const parse = (iso: string): Date | null => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

function groupOf(d: Date, now: Date): DayGroup {
  const day = localToday(d);
  if (day === localToday(now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return day === localToday(yesterday) ? 'Yesterday' : 'Earlier';
}

const clock = (d: Date) => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;

/** When a chat started: "8:02 AM", "Yesterday 3:14 PM", "Mon, Oct 5", or with the year if not this year. */
export function chatTime(iso: string, now: Date = new Date()): string {
  const d = parse(iso);
  if (!d) return '';
  const group = groupOf(d, now);
  if (group === 'Today') return clock(d);
  if (group === 'Yesterday') return `Yesterday ${clock(d)}`;
  const date = `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? date : `${date}, ${d.getFullYear()}`;
}

export function chatLabel(chat: ChatRecord, now: Date = new Date()): string {
  const time = chatTime(chat.createdAt, now);
  return time ? `${chatName(chat.title)} · ${time}` : chatName(chat.title);
}

const newestFirst = (a: ChatRecord, b: ChatRecord) => b.createdAt.localeCompare(a.createdAt);

/** Chats grouped by the day they started, newest first; empty groups are left out. */
export function groupChats(chats: ChatRecord[], now: Date = new Date()): { group: DayGroup; chats: ChatRecord[] }[] {
  const order: DayGroup[] = ['Today', 'Yesterday', 'Earlier'];
  const byGroup = new Map<DayGroup, ChatRecord[]>(order.map((g) => [g, []]));
  for (const c of [...chats].sort(newestFirst)) {
    const d = parse(c.createdAt);
    byGroup.get(d ? groupOf(d, now) : 'Earlier')!.push(c);
  }
  return order.filter((g) => byGroup.get(g)!.length > 0).map((g) => ({ group: g, chats: byGroup.get(g)! }));
}

/** The newest `limit` chats, plus the open chat if it is older than that. */
export function dropdownChats(chats: ChatRecord[], activeId: string | null, limit = DROPDOWN_LIMIT): ChatRecord[] {
  const newest = [...chats].sort(newestFirst).slice(0, limit);
  const active = activeId ? chats.find((c) => c.id === activeId) : undefined;
  return active && !newest.includes(active) ? [...newest, active] : newest;
}
