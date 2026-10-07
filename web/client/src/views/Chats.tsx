import { useChat } from '../chat/ChatContext';

export function ChatsView() {
  const chat = useChat();
  return (
    <>
      <h1>Chats</h1>
      {chat.chats.length === 0 && <p className="muted">No conversations yet.</p>}
      <div className="card" style={{ padding: 0 }}>
        {chat.chats.map((c) => (
          <div className="list-row" key={c.id}>
            <span className="grow">{c.title}</span>
            <span className="muted">{new Date(c.lastUsedAt).toLocaleString()}</span>
            <button onClick={() => chat.open(c.id)}>{c.id === chat.activeId ? 'Open (current)' : 'Open'}</button>
          </div>
        ))}
      </div>
    </>
  );
}
