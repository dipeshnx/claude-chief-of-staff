import { useChat } from '../chat/ChatContext';
import { chatName, chatTime, groupChats } from '../chat/chatLabels';

export function ChatsView() {
  const chat = useChat();
  return (
    <>
      <h1>Chats</h1>
      {chat.chats.length === 0 && <p className="muted">No conversations yet.</p>}
      {groupChats(chat.chats).map(({ group, chats }) => (
        <section key={group}>
          <h2>{group} ({chats.length})</h2>
          <div className="card" style={{ padding: 0 }}>
            {chats.map((c) => (
              <div className="list-row" key={c.id}>
                <span className="grow">{chatName(c.title)}</span>
                <span className="muted">{chatTime(c.createdAt)}</span>
                <button onClick={() => chat.open(c.id)}>{c.id === chat.activeId ? 'Open (current)' : 'Open'}</button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
