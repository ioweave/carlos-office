import { useRef } from "react";
import { IconArrowUp, IconFile, IconMicrophone, IconPaperclip, IconPlayerStop, IconX } from "@tabler/icons-react";

const MAX_FILES = 8;
const MAX_FILE_BYTES = 8_388_608;
const formatBytes = value => value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 ** 2).toFixed(1)} MB`;

export default function ChatComposer({ input, setInput, onSend, sending, onStop, files, setFiles, agentName, textareaRef, listening, toggleListening }) {
  const fileRef = useRef(null);

  const resize = () => requestAnimationFrame(() => {
    const target = textareaRef.current;
    if (!target) return;
    target.style.height = "auto";
    target.style.height = `${Math.min(target.scrollHeight, 220)}px`;
  });

  const chooseFiles = event => {
    const chosen = [...(event.target.files || [])];
    event.target.value = "";
    const next = [...files];
    for (const file of chosen) {
      if (next.length >= MAX_FILES) break;
      if (file.size > MAX_FILE_BYTES) continue;
      next.push({ file, name: file.name, size: file.size, localId: crypto.randomUUID() });
    }
    setFiles(next);
  };

  return (
    <div className="chat__composer-zone">
      {!!files.length && (
        <div className="chat__pending-files">
          {files.map(file => (
            <div key={file.localId} className="chat__pending-file">
              <IconFile size={15} />
              <span><strong className="chat__pending-file-name">{file.name}</strong><small className="chat__pending-file-size">{formatBytes(file.size)}</small></span>
              <button type="button" className="icon-button" onClick={() => setFiles(current => current.filter(item => item.localId !== file.localId))} aria-label={`Remove ${file.name}`}><IconX size={14} /></button>
            </div>
          ))}
        </div>
      )}

      <form className="chat__composer" onSubmit={onSend}>
        <textarea
          id="message-input"
          className="chat__composer-input"
          ref={textareaRef}
          value={input}
          onChange={event => { setInput(event.target.value); resize(); }}
          onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); } }}
          rows={1}
          aria-label={`Message ${agentName}`}
          placeholder={`Message ${agentName}…`}
        />
        <div className="chat__composer-toolbar">
          <div className="chat__composer-tools">
            <input ref={fileRef} type="file" multiple hidden onChange={chooseFiles} />
            <button type="button" className="icon-button" onClick={() => fileRef.current?.click()} aria-label="Attach files"><IconPaperclip size={19} /></button>
            <button type="button" className={`icon-button ${listening ? "chat__composer-tool--active" : ""}`} onClick={toggleListening} aria-label="Dictate message">{listening ? <IconPlayerStop size={19} /> : <IconMicrophone size={19} />}</button>
            <span className="chat__composer-context">{agentName} · saved chat</span>
          </div>
          {sending ? (
            <button type="button" className="chat__stop" onClick={onStop} aria-label="Stop"><IconPlayerStop size={18} /></button>
          ) : (
            <button type="submit" className="chat__send" disabled={!input.trim() && !files.length} aria-label="Send message"><IconArrowUp size={19} /></button>
          )}
        </div>
      </form>
      <p className="chat__composer-hint">Saved to Obsidian · Enter to send · Shift+Enter for a new line</p>
    </div>
  );
}