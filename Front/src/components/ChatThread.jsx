import { useMemo, useRef } from "react";
import {
  IconCopy,
  IconFile,
  IconPaperclip,
  IconPencil,
  IconShare,
  IconVolume,
} from "@tabler/icons-react";

import MarkdownContent from "./MarkdownContent";
import WorkflowLink from "./WorkflowLink";
import { formatChatTime } from "../lib/chatPresentation";

export default function ChatThread({
  threadRef,
  conversation,
  attachments,
  artifacts,
  working,
  editingMessageId,
  messageDraft,
  speakingMessageId,
  onMessageDraftChange,
  onBeginMessageEdit,
  onCommitMessageEdit,
  onCancelMessageEdit,
  onOpenAttachment,
  onOpenArtifact,
  onCopyMessage,
  onShareMessage,
  onToggleReadAloud,
  onOpenOperations,
}) {
  const editCancelledRef = useRef(false);
  const attachmentById = useMemo(
    () => Object.fromEntries((attachments || []).map(item => [item.id, item])),
    [attachments],
  );
  const artifactById = useMemo(
    () => Object.fromEntries((artifacts || []).map(item => [item.id, item])),
    [artifacts],
  );

  return (
    <div ref={threadRef} className="chat-thread">
      {!conversation?.messages?.length ? (
        <div className="chat-welcome">
          <div className="chat-welcome__mark">N</div>
          <h2>What do you need?</h2>
          <p>Ask Nora directly. She decides whether to answer, use a capability, or start a Workflow.</p>
        </div>
      ) : (
        <div className="chat-thread__messages">
          {conversation.messages.map(message => {
            const isCarlos = message.actor === "Carlos";
            const editing = isCarlos && editingMessageId === message.id;
            const messageArtifacts = (message.artifacts || []).map(id => artifactById[id]).filter(Boolean);
            return (
              <article key={message.id} className={`message ${isCarlos ? "message--carlos" : "message--nora"}`}>
                <header className="message__header">
                  <strong>{isCarlos ? "Carlos" : "Nora"}</strong>
                  <small>{message.pending ? "Sending…" : formatChatTime(message.at)}</small>
                </header>

                {editing ? (
                  <textarea
                    autoFocus
                    className="message__editor"
                    value={messageDraft}
                    onFocus={() => { editCancelledRef.current = false; }}
                    onChange={event => onMessageDraftChange(event.target.value)}
                    onBlur={() => {
                      if (editCancelledRef.current) {
                        editCancelledRef.current = false;
                        return;
                      }
                      onCommitMessageEdit(message);
                    }}
                    onKeyDown={event => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        editCancelledRef.current = true;
                        onCancelMessageEdit();
                        event.currentTarget.blur();
                      }
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                    }}
                    aria-label="Edit Carlos message"
                  />
                ) : (
                  <div className="message__content">
                    <MarkdownContent artifacts={messageArtifacts} onArtifact={onOpenArtifact}>{message.content}</MarkdownContent>
                  </div>
                )}

                {message.workflowId && (
                  <WorkflowLink
                    workflowId={message.workflowId}
                    artifacts={artifacts}
                    onOpen={onOpenOperations}
                  />
                )}

                {!!message.attachments?.length && (
                  <div className="message__attachments" aria-label="Message attachments">
                    {message.attachments.map(id => {
                      const attachment = attachmentById[id];
                      return attachment ? (
                        <button key={id} type="button" onClick={() => onOpenAttachment(attachment)}>
                          <IconPaperclip size={14} /> {attachment.name}
                        </button>
                      ) : null;
                    })}
                  </div>
                )}

                {!!messageArtifacts.length && (
                  <div className="message__artifacts" aria-label="Message artifacts">
                    {messageArtifacts.map(artifact => (
                      <button key={artifact.id} type="button" onClick={() => onOpenArtifact(artifact)}>
                        <IconFile size={14} /> {artifact.name}
                      </button>
                    ))}
                  </div>
                )}

                {!editing && !message.pending && (
                  <div className={`message__actions ${isCarlos ? "message__actions--carlos" : "message__actions--nora"}`}>
                    <button type="button" onClick={() => void onCopyMessage(message)} aria-label="Copy message" title="Copy">
                      <IconCopy size={14} />
                    </button>
                    {isCarlos ? (
                      <button
                        type="button"
                        onClick={() => onBeginMessageEdit(message)}
                        disabled={working}
                        aria-label="Edit message"
                        title="Edit"
                      >
                        <IconPencil size={14} />
                      </button>
                    ) : (
                      <>
                        <button type="button" onClick={() => void onShareMessage(message)} aria-label="Share Nora response" title="Share">
                          <IconShare size={14} />
                        </button>
                        <button
                          type="button"
                          className={speakingMessageId === message.id ? "message__action--active" : ""}
                          onClick={() => onToggleReadAloud(message)}
                          aria-label={speakingMessageId === message.id ? "Stop read aloud" : "Read aloud"}
                          title={speakingMessageId === message.id ? "Stop read aloud" : "Read aloud"}
                        >
                          <IconVolume size={14} />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </article>
            );
          })}

          {working && (
            <article className="message message--nora message--thinking">
              <header className="message__header"><strong>Nora</strong></header>
              <div className="message__content"><span className="spinner" /> Working…</div>
            </article>
          )}
        </div>
      )}
    </div>
  );
}
