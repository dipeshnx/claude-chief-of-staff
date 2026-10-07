const STORAGE_KEY = 'cos-active-chat';

// localStorage can throw (privacy modes) or be absent; remembering the chat is a nicety.
export function loadActiveChat(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveActiveChat(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Keep a remembered chat only if the server still lists it. */
export function reconcileActiveChat(remembered: string | null, chats: { id: string }[]): string | null {
  return remembered && chats.some((c) => c.id === remembered) ? remembered : null;
}
