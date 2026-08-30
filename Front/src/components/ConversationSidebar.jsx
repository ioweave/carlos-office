import { IconMessageCircle, IconPlus, IconTrash } from "@tabler/icons-react";

import { conversationTitle, formatChatTime } from "../lib/chatPresentation";

export default function ConversationSidebar({
  conversations,
  activeConversationId,
  unreadConversationIds,
  editingConversationId,
  titleDraft,
  onTitleDraftChange,
  onBeginRename,
  onCancelRename,
  onFinishRename,
  onOpen,
  onDelete,
  onNew,
  workingConversationId = "",
}) {
  const unread = new Set(unreadConversationIds || []);

  return (
    <aside className="chat-history">
      <header className="chat-history__header">
        <h1>Conversations</h1>
        <button type="button" className="icon-button" onClick={onNew} aria-label="New conversation">
          <IconPlus size={18} />
        </button>
      </header>

      <div className="chat-history__list">
        {!conversations.length ? (
          <div className="empty-state empty-state--compact">
            <IconMessageCircle size={22} stroke={1.5} />
            <strong>No conversations yet</strong>
            <span>Start with Nora.</span>
          </div>
        ) : conversations.map(item => (
          <div key={item.id} className={`conversation-row ${activeConversationId === item.id ? "conversation-row--active" : ""}`}>
            {editingConversationId === item.id ? (
              <div className="conversation-row__open">
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={event => onTitleDraftChange(event.target.value)}
                  onFocus={event => event.currentTarget.select()}
                  onBlur={onCancelRename}
                  onKeyDown={event => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void onFinishRename(item);
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      onCancelRename();
                    }
                  }}
                  aria-label={`Rename ${conversationTitle(item)}`}
                  style={{
                    width: "100%",
                    minWidth: 0,
                    padding: 0,
                    border: 0,
                    borderRadius: "2px",
                    outline: "1px solid var(--color-accent)",
                    outlineOffset: "1px",
                    background: "transparent",
                    color: "var(--color-text)",
                    font: "inherit",
                    fontSize: "11px",
                    fontWeight: 700,
                    lineHeight: 1.2,
                  }}
                />
                <small>{formatChatTime(item.lastMessageAt)}</small>
              </div>
            ) : (
              <button
                type="button"
                className="conversation-row__open"
                onClick={event => {
                  if (event.target.closest("[data-edit-conversation-title]")) {
                    onBeginRename(item);
                    return;
                  }
                  onOpen(item.id);
                }}
                aria-label={`Open ${conversationTitle(item)}`}
                title="Click the title to rename; click elsewhere to open"
              >
                <span className="conversation-row__title">
                  <strong data-edit-conversation-title>{conversationTitle(item)}</strong>
                  {unread.has(item.id) && (
                    <span className="conversation-row__unread" aria-label="Unread Nora response" title="Unread Nora response" />
                  )}
                </span>
                <small>{formatChatTime(item.lastMessageAt)}</small>
              </button>
            )}
            <div className="conversation-row__actions">
              <button
                type="button"
                className="conversation-row__action conversation-row__action--danger"
                onClick={() => onDelete(item)}
                disabled={workingConversationId === item.id}
                aria-label={`Delete ${conversationTitle(item)}`}
                title="Delete"
              >
                <IconTrash size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
