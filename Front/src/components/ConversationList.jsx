import { IconPlus, IconRefresh, IconSearch, IconX } from "@tabler/icons-react";

const deriveTitle = conversation => {
  const firstUser = conversation.messages?.find(message => message.actor === "Carlos");
  if (firstUser?.content) return firstUser.content.slice(0, 60).trim() || conversation.id;
  return conversation.id;
};

const lastMessage = conversation => conversation.messages?.[conversation.messages?.length - 1] || null;

const formatTime = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

export default function ConversationList({
  conversations,
  conversationId,
  onOpen,
  onRefresh,
  onNew,
  search,
  setSearch,
  loading,
  onClose,
}) {
  const query = search.trim().toLowerCase();
  const filtered = conversations.filter(item => {
    if (!query) return true;
    return deriveTitle(item).toLowerCase().includes(query) || item.id.toLowerCase().includes(query);
  });

  return (
    <div className="chat__history-panel">
      <header className="chat__history-header">
        <div>
          <strong className="chat__history-title">Conversations</strong>
          <small className="chat__history-meta">Saved workspace threads</small>
        </div>
        <div className="chat__history-actions">
          <button
            type="button"
            className="icon-button"
            onClick={onRefresh}
            aria-label="Refresh conversations"
            title="Refresh"
          >
            <IconRefresh size={17} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={onNew}
            aria-label="New conversation"
            title="New conversation"
          >
            <IconPlus size={18} />
          </button>
          {onClose && (
            <button
              type="button"
              className="icon-button chat__history-close"
              onClick={onClose}
              aria-label="Close conversation history"
            >
              <IconX size={18} />
            </button>
          )}
        </div>
      </header>

      <label className="chat__search">
        <IconSearch size={16} />
        <input
          className="chat__search-input"
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Search threads…"
          aria-label="Search conversations"
        />
      </label>

      <div className="chat__conversation-list">
        {loading && <p className="chat__empty-copy">Loading…</p>}
        {!loading && !filtered.length && <p className="chat__empty-copy">No conversations yet.</p>}
        {filtered.map(item => {
          const last = lastMessage(item);
          return (
            <button
              key={item.id}
              type="button"
              className={`chat__conversation ${item.id === conversationId ? "chat__conversation--active" : ""}`}
              onClick={() => onOpen(item.id)}
            >
              <span className="chat__conversation-heading">
                <strong className="chat__conversation-title">{deriveTitle(item)}</strong>
                <time className="chat__conversation-time" dateTime={last?.at}>{formatTime(last?.at)}</time>
              </span>
              <span className="chat__conversation-preview">
                {last?.content?.slice(0, 80) || `${item.messages?.length || 0} messages`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}