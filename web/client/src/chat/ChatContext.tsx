import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ApprovalRequest, ChatRecord } from '../../../shared/types';
import { api } from '../api';
import { useServerMessage, useSocket } from '../socket';
import { loadActiveChat, reconcileActiveChat, saveActiveChat } from './activeChat';
import { applyEvent, emptyChat, fromHistory, type ChatView } from './chatReducer';

export interface ChatApi {
  connected: boolean;
  chats: ChatRecord[];
  activeId: string | null;
  view: ChatView;
  approvals: ApprovalRequest[];
  paneOpen: boolean;
  notice: string | null;
  setPaneOpen(open: boolean): void;
  send(text: string): void;
  newChat(): void;
  open(id: string): void;
  stop(): void;
  /** Returns false if the decision could not be sent (socket not open). */
  decide(id: string, allow: boolean, message?: string): boolean;
}

const ChatContext = createContext<ChatApi | null>(null);
const LOST_BEFORE_START = 'Connection lost before the chat started — please resend.';

export function ChatProvider({ children }: { children: ReactNode }) {
  const socket = useSocket();
  // The open chat survives a page reload; the connect effect below reopens it.
  const [activeId, setActiveIdState] = useState<string | null>(loadActiveChat);
  const activeRef = useRef<string | null>(activeId);
  const setActiveId = (id: string | null) => { activeRef.current = id; setActiveIdState(id); saveActiveChat(id); };
  // Checked once against the first chat list: a brand-new chat may not be listed yet on later refreshes.
  const restoreChecked = useRef(false);
  const restoredId = useRef(activeId);
  const [views, setViews] = useState<Record<string, ChatView>>({});
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [chats, setChats] = useState<ChatRecord[]>([]);
  const [paneOpen, setPaneOpen] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  // A new chat's id comes back in chat.created; messages typed before then wait here.
  const pendingNew = useRef<{ ref: string; queued: string[] } | null>(null);

  const refreshChats = useCallback(() => {
    api<ChatRecord[]>('GET', '/api/chats').then((list) => {
      setChats(list);
      if (!restoreChecked.current) {
        restoreChecked.current = true;
        const stillRestored = activeRef.current !== null && activeRef.current === restoredId.current;
        if (stillRestored && !reconcileActiveChat(activeRef.current, list)) setActiveId(null);
      }
    }, () => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(refreshChats, [refreshChats]);

  // After a reconnect, resync the visible chat (events may have been missed while offline).
  useEffect(() => {
    if (!socket.connected) {
      // A chat that was still being created can't be trusted to arrive; don't queue behind it forever.
      if (pendingNew.current) setNotice(LOST_BEFORE_START);
      pendingNew.current = null;
      return;
    }
    if (activeRef.current) socket.send({ type: 'chat.open', chatId: activeRef.current });
  }, [socket.connected]); // eslint-disable-line react-hooks/exhaustive-deps

  useServerMessage((m) => {
    switch (m.type) {
      case 'chat.created':
        // A created chat whose request was abandoned (newChat/open/disconnect) only refreshes the list.
        if (pendingNew.current && m.clientRef === pendingNew.current.ref) {
          const { queued } = pendingNew.current;
          pendingNew.current = null;
          setActiveId(m.chatId);
          for (const text of queued) socket.send({ type: 'chat.send', chatId: m.chatId, text });
        }
        refreshChats();
        return;
      case 'chat.event':
        setViews((v) => ({ ...v, [m.chatId]: applyEvent(v[m.chatId] ?? emptyChat, m.event) }));
        return;
      case 'chat.history':
        setViews((v) => ({ ...v, [m.chatId]: fromHistory(m.events, m.running, m.resumed) }));
        return;
      case 'approval.snapshot':
        setApprovals(m.requests);
        if (m.requests.length) setPaneOpen(true);
        return;
      case 'approval.request':
        setApprovals((a) => (a.some((x) => x.id === m.request.id) ? a : [...a, m.request]));
        setPaneOpen(true);
        return;
      case 'approval.resolved':
        setApprovals((a) => a.filter((x) => x.id !== m.id));
        return;
      case 'chats.changed':
        refreshChats();
        return;
      case 'error':
        setNotice(`Server: ${m.message}`);
        return;
    }
  });

  const send = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    setPaneOpen(true);
    setNotice(null);
    if (activeRef.current) return socket.send({ type: 'chat.send', chatId: activeRef.current, text: t });
    if (pendingNew.current) return void pendingNew.current.queued.push(t);
    const ref = crypto.randomUUID();
    pendingNew.current = { ref, queued: [] };
    // Not queued while offline (it would run after the user was told to resend), so say so now.
    if (!socket.send({ type: 'chat.send', text: t, clientRef: ref })) {
      pendingNew.current = null;
      setNotice(LOST_BEFORE_START);
    }
  }, [socket]);

  const value: ChatApi = {
    connected: socket.connected,
    chats,
    activeId,
    view: (activeId && views[activeId]) || emptyChat,
    approvals,
    paneOpen,
    notice,
    setPaneOpen,
    send,
    newChat: () => { pendingNew.current = null; setActiveId(null); },
    open: (id) => {
      pendingNew.current = null;
      setActiveId(id);
      setPaneOpen(true);
      socket.send({ type: 'chat.open', chatId: id });
    },
    stop: () => { if (activeRef.current) socket.send({ type: 'chat.stop', chatId: activeRef.current }); },
    decide: (id, allow, message) => socket.send({ type: 'approval.decide', id, allow, message }),
  };
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatApi {
  const c = useContext(ChatContext);
  if (!c) throw new Error('useChat must be used inside ChatProvider');
  return c;
}
