import { useRef } from "react";
import { IconArrowUp, IconMicrophone, IconPaperclip, IconPlus, IconX } from "@tabler/icons-react";

export default function ChatComposer({
  textareaRef,
  input,
  files,
  working,
  listening,
  editingMessageId,
  onInputChange,
  onPaste,
  onFilesSelected,
  onRemoveFile,
  onToggleSpeech,
  onStop,
  onSubmit,
  onEnter,
}) {
  const fileInputRef = useRef(null);

  return (
    <form className="chat-composer" onSubmit={onSubmit}>
      {files.length > 0 && (
        <div className="chat-composer__files">
          {files.map((file, index) => (
            <span key={`${file.name}-${file.size}-${index}`}>
              <IconPaperclip size={13} /> {file.name}
              <button type="button" onClick={() => onRemoveFile(index)} aria-label={`Remove ${file.name}`}>
                <IconX size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={input}
        onChange={event => onInputChange(event.target.value)}
        onPaste={onPaste}
        onKeyDown={event => {
          if (event.key !== "Enter" || event.shiftKey) return;
          event.preventDefault();
          onEnter(event);
        }}
        placeholder={listening ? "Listening…" : "Message Nora…"}
        rows={1}
      />

      <div className="chat-composer__actions">
        <div className="chat-composer__actions-left">
          <input ref={fileInputRef} type="file" multiple hidden onChange={onFilesSelected} />
          <button
            type="button"
            className="composer-attach"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach files"
            title="Attach files"
          >
            <IconPlus size={20} />
          </button>
        </div>

        <div className="chat-composer__actions-right">
          {!working && (
            <button
              type="button"
              className={`composer-mic ${listening ? "composer-mic--active" : ""}`}
              onClick={onToggleSpeech}
              disabled={Boolean(editingMessageId)}
              aria-label={listening ? "Stop dictation" : "Speak to Nora"}
              title={listening ? "Stop dictation" : "Speak to Nora"}
            >
              <IconMicrophone size={18} />
            </button>
          )}
          {working ? (
            <button type="button" className="button button--danger" onClick={onStop}>Stop</button>
          ) : (
            <button
              type="submit"
              className="composer-send"
              disabled={Boolean(editingMessageId) || (!input.trim() && files.length === 0)}
              aria-label="Send message"
            >
              <IconArrowUp size={18} />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
