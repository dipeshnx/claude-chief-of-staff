import { describe, expect, it } from 'vitest';
import { loadActiveChat, reconcileActiveChat, saveActiveChat } from '../client/src/chat/activeChat';

describe('reconcileActiveChat', () => {
  const chats = [{ id: 'a' }, { id: 'b' }];
  it('keeps a remembered chat the server still lists', () => {
    expect(reconcileActiveChat('b', chats)).toBe('b');
  });
  it('drops a remembered chat the server no longer knows', () => {
    expect(reconcileActiveChat('gone', chats)).toBeNull();
    expect(reconcileActiveChat('a', [])).toBeNull();
  });
  it('passes through "no remembered chat"', () => {
    expect(reconcileActiveChat(null, chats)).toBeNull();
  });
});

describe('load/saveActiveChat', () => {
  it('never throws when storage is unavailable', () => {
    // The node test environment has no window/localStorage at all.
    expect(() => saveActiveChat('x')).not.toThrow();
    expect(loadActiveChat()).toBeNull();
  });
});
