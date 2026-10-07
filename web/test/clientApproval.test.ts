import { describe, expect, it } from 'vitest';
import { approvalFields } from '../client/src/chat/ApprovalCard';
import { queueWhileOffline } from '../client/src/socket';

describe('approvalFields', () => {
  it('lists every input key, highlighted keys first in highlight order', () => {
    const fields = approvalFields({ zeta: 1, htmlBody: '<b>x</b>', to: 'a@b.c', draftId: 'd1', alpha: true });
    expect(fields).toEqual([
      { key: 'to', highlight: true },
      { key: 'draftId', highlight: true },
      { key: 'htmlBody', highlight: true },
      { key: 'zeta', highlight: false },
      { key: 'alpha', highlight: false },
    ]);
  });

  it('highlights the extended keys', () => {
    const keys = ['htmlBody', 'draftId', 'attachments', 'forwardText', 'attendees', 'summary', 'description', 'old_string', 'new_string'];
    const fields = approvalFields(Object.fromEntries(keys.map((k) => [k, 'v'])));
    expect(fields.every((f) => f.highlight)).toBe(true);
    expect(fields.map((f) => f.key).sort()).toEqual([...keys].sort());
  });

  it('treats a null or non-object input as having no fields', () => {
    expect(approvalFields(null)).toEqual([]);
    expect(approvalFields('oops')).toEqual([]);
    expect(approvalFields([1, 2])).toEqual([]);
    expect(approvalFields(undefined)).toEqual([]);
  });
});

describe('queueWhileOffline', () => {
  it('never queues decisions or new-chat sends; queues the rest', () => {
    expect(queueWhileOffline({ type: 'approval.decide', id: 'x', allow: true })).toBe(false);
    expect(queueWhileOffline({ type: 'chat.send', text: 'hi', clientRef: 'r' })).toBe(false);
    expect(queueWhileOffline({ type: 'chat.send', chatId: 'c', text: 'hi' })).toBe(true);
    expect(queueWhileOffline({ type: 'chat.open', chatId: 'c' })).toBe(true);
    expect(queueWhileOffline({ type: 'chat.stop', chatId: 'c' })).toBe(true);
  });
});
