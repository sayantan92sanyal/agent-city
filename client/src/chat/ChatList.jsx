/**
 * The chat list column: a "+ NEW CHAT" button and the past chats, newest
 * first. Each chat opens on click and has its own delete button (the
 * caller confirms).
 */
export function ChatList({ chats, activeId, onSelect, onNew, onDelete }) {
  return (
    <aside className="chat-list">
      <div className="chat-list-header">
        <h2 className="chat-list-title">CHATS</h2>
        <button type="button" className="chat-new-btn" onClick={onNew}>
          + NEW CHAT
        </button>
      </div>
      <ul className="chat-list-items" aria-label="Chats">
        {chats.map((chat) => {
          const active = chat.id === activeId;
          return (
            <li key={chat.id} className={`chat-list-item${active ? ' chat-list-item-active' : ''}`}>
              <button
                type="button"
                className="chat-list-open"
                aria-current={active ? 'true' : undefined}
                title={chat.title}
                onClick={() => onSelect(chat.id)}
              >
                {chat.running && <span className="chat-list-running" aria-hidden="true" />}
                {chat.title}
              </button>
              <button
                type="button"
                className="chat-list-delete"
                aria-label={`Delete ${chat.title}`}
                title="Delete chat"
                onClick={() => onDelete(chat.id)}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
