import { useEffect, useRef, useState } from 'react';
import { SafeMarkdown } from '../markdown';
import { ApprovalCard, prettyTool } from './ApprovalCard';
import { useChat } from './ChatContext';
import type { ChatItem } from './chatReducer';
import { useResizableWidth } from './useResizableWidth';

const COMMANDS = ['/gm', '/triage', '/my-tasks overdue', '/enrich stale'];

function ItemView({ item, onResume }: { item: ChatItem; onResume(): void }) {
  switch (item.kind) {
    case 'user':
      return <div className="msg user">{item.text}</div>;
    case 'assistant':
      return <div className="msg assistant"><SafeMarkdown>{item.text}</SafeMarkdown></div>;
    case 'tool':
      return (
        <details className={`tool${item.result?.isError ? ' failed' : ''}`}>
          <summary>{prettyTool(item.name)}{item.result ? (item.result.isError ? ' (failed)' : '') : ' …'}</summary>
          <pre>{JSON.stringify(item.input, null, 2)}</pre>
          {item.result && <pre>{item.result.content}</pre>}
        </details>
      );
    case 'turn':
      return (
        <div className="turn muted">
          {item.costUsd !== null && `≈ $${item.costUsd.toFixed(4)}`}
          {item.durationMs !== null && ` · ${(item.durationMs / 1000).toFixed(1)}s`}
        </div>
      );
    case 'error':
      return (
        <div className="msg error">
          <strong>{item.message}</strong>
          {item.stderr.length > 0 && <pre>{item.stderr.join('\n')}</pre>}
          <button onClick={onResume} title="Restarts Claude on this conversation and sends “continue”">Resume</button>
        </div>
      );
  }
}

export function ChatPane() {
  const chat = useChat();
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const { width, handleProps } = useResizableWidth();
  const last = chat.view.items.at(-1);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [chat.view.items.length, last]);

  if (!chat.paneOpen) {
    return (
      <button className="chat-tab" onClick={() => chat.setPaneOpen(true)}>
        Chat{chat.approvals.length > 0 && ` · ${chat.approvals.length} waiting`}
      </button>
    );
  }

  const submit = () => {
    chat.send(draft);
    setDraft('');
  };
  const titleOf = (chatId: string) => chat.chats.find((c) => c.id === chatId)?.title ?? `chat ${chatId.slice(0, 8)}`;

  return (
    <aside className="chat" style={{ width }}>
      <div className="chat-resize" {...handleProps} />
      <header className="chat-head">
        <select aria-label="Conversation" value={chat.activeId ?? ''} onChange={(e) => (e.target.value ? chat.open(e.target.value) : chat.newChat())}>
          <option value="">New chat</option>
          {chat.chats.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <button onClick={chat.newChat}>New</button>
        <button aria-label="Collapse chat" onClick={() => chat.setPaneOpen(false)}>⟩</button>
      </header>
      {!chat.connected && <div className="banner warn">Reconnecting to the server…</div>}
      {chat.notice && <div className="banner warn">{chat.notice}</div>}
      <div className="commands">
        {COMMANDS.map((c) => <button key={c} onClick={() => chat.send(c)}>{c}</button>)}
      </div>
      {chat.approvals.map((a) => <ApprovalCard key={a.id} request={a} chatTitle={titleOf(a.chatId)} connected={chat.connected} onDecide={chat.decide} />)}
      <div className="messages">
        {chat.view.resumed && <p className="muted">Resumed conversation. Earlier messages are in Claude's context but aren't shown here.</p>}
        {chat.view.items.length === 0 && !chat.view.resumed && <p className="muted">Ask anything, or run a command above.</p>}
        {chat.view.items.map((item, i) => <ItemView key={i} item={item} onResume={() => chat.send('continue')} />)}
        {chat.view.running && (
          <div className="running">Claude is working… <button onClick={chat.stop}>Stop</button></div>
        )}
        <div ref={endRef} />
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <textarea
          rows={3}
          value={draft}
          placeholder="Message Claude (Enter to send, Shift+Enter for a new line)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="submit" className="primary" disabled={!draft.trim()}>Send</button>
      </form>
    </aside>
  );
}
