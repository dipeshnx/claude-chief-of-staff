import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ClientMsg, ServerMsg } from '../../shared/types';
import { token } from './api';

type Listener = (msg: ServerMsg) => void;
interface SocketApi { connected: boolean; send(msg: ClientMsg): boolean; subscribe(l: Listener): () => void }

const SocketContext = createContext<SocketApi | null>(null);

/**
 * Whether a message sent while disconnected should be replayed on reconnect. Decisions never are: the card is
 * re-shown from the snapshot instead. Nor is a new-chat send (clientRef): the UI asks the user to resend it.
 */
export function queueWhileOffline(m: ClientMsg): boolean {
  if (m.type === 'approval.decide') return false;
  if (m.type === 'chat.send' && m.clientRef) return false;
  return true;
}

export function SocketProvider({ children }: { children: ReactNode }) {
  const listeners = useRef(new Set<Listener>());
  const wsRef = useRef<WebSocket | null>(null);
  const outbox = useRef<ClientMsg[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let stopped = false;
    let retry = 0;
    let timer: number | undefined;
    const open = () => {
      const ws = new WebSocket(`ws://${window.location.host}/ws?t=${encodeURIComponent(token())}`);
      wsRef.current = ws;
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
        for (const m of outbox.current.splice(0)) ws.send(JSON.stringify(m));
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(String(e.data)) as ServerMsg;
        listeners.current.forEach((l) => l(msg));
      };
      ws.onclose = () => {
        setConnected(false);
        if (!stopped) timer = window.setTimeout(open, Math.min(10_000, 500 * 2 ** retry++));
      };
    };
    open();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      wsRef.current?.close();
    };
  }, []);

  const value = useMemo<SocketApi>(() => ({
    connected,
    send: (m) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(m));
        return true;
      }
      if (queueWhileOffline(m)) outbox.current.push(m);
      return false;
    },
    subscribe: (l) => {
      listeners.current.add(l);
      return () => { listeners.current.delete(l); };
    },
  }), [connected]);

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketApi {
  const s = useContext(SocketContext);
  if (!s) throw new Error('useSocket must be used inside SocketProvider');
  return s;
}

export function useServerMessage(handler: Listener): void {
  const { subscribe } = useSocket();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe((m) => ref.current(m)), [subscribe]);
}
