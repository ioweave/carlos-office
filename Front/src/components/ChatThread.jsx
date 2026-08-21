import { useEffect, useRef } from "react";
import { IconCheck, IconCopy, IconFile, IconPaperclip, IconVolume } from "@tabler/icons-react";
import MarkdownMessage from "./MarkdownMessage";
import WorkflowSummary from "./WorkflowSummary";

const formatTime = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const Turn = ({
  message,
  agentName,
  richArtifacts,
  messageArtifacts,
  activeArtifactId,
  onArtifactSelect,
  copied,
  onCopy,
  speaking,
  onSpeak,
  onStopSpeak,
  index,
}) => {
  const isUser = message.role === "user";

  return (
    <article className={`chat__turn chat__turn--${isUser ? "user" : "assistant"}`}>
      <div className="chat__turn-meta">
        <strong className="chat__turn-meta-author">{isUser ? "Carlos" : agentName}</strong>
        <span>{formatTime(message.at)}</span>
        {!isUser && (
          <div className="chat__turn-actions">
            <button
              type="button"
              className="icon-button"
              onClick={() => onCopy(message.content, index)}
              aria-label="Copy response"
              title="Copy response"
            >
              {copied === index ? <IconCheck size={15} /> : <IconCopy size={15} />}
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => speaking === index ? onStopSpeak() : onSpeak(message.content, index)}
              aria-label="Read response aloud"
              title="Read response aloud"
            >
              <IconVolume size={15} />
            </button>
          </div>
        )}
      </div>
      <div className="chat__turn-body">
        {isUser
          ? <div className="chat__user-bubble">{message.content}</div>
          : <MarkdownMessage content={message.content} artifacts={richArtifacts} onArtifactSelect={onArtifactSelect} />}
      </div>
      {!!messageArtifacts.length && (
        <div className="chat__artifacts" aria-label={isUser ? "Attached artifacts" : "Generated artifacts"}>
          <span className="chat__artifacts-label">
            {isUser
              ? <><IconPaperclip size={12} /> Attachments</>
              : <><IconFile size={12} /> Artifacts</>}
          </span>
          {messageArtifacts.map(artifact => (
            <button
              type="button"
              key={artifact.id}
              className={`chat__artifact-link ${activeArtifactId === artifact.id ? "chat__artifact-link--active" : ""}`}
              onClick={() => onArtifactSelect(artifact.id)}
            >
              <IconFile size={16} />
              <span>
                <strong className="chat__artifact-link-name">{artifact.name}</strong>
                <small className="chat__artifact-link-meta">{artifact.type || "file"}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </article>
  );
};

export default function ChatThread({
  messages,
  agentName,
  artifacts,
  activeArtifactId,
  onArtifactSelect,
  sending,
  copied,
  onCopy,
  speaking,
  onSpeak,
  onStopSpeak,
  onOpenOperations,
  onWorkflowSettled,
  workflowId,
}) {
  const scrollRef = useRef(null);
  const richArtifacts = artifacts.map(item => ({ ...item, artifactId: item.id, title: item.name }));
  const resolveArtifacts = ids => (ids || [])
    .map(id => artifacts.find(item => item.id === id))
    .filter(Boolean);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, sending, workflowId]);

  return (
    <div className="chat__scroll" ref={scrollRef}>
      <div className="chat__thread">
        {!messages.length && (
          <div className="chat__welcome">
            <h2 className="chat__welcome-title">Start a conversation with {agentName}</h2>
            <p className="chat__welcome-copy">
              Send a request and Nora will respond, run a Workflow, or create a Tool or Skill.
            </p>
          </div>
        )}
        {messages.map((message, index) => (
          <Turn
            key={message.id || index}
            index={index}
            message={message}
            agentName={agentName}
            richArtifacts={richArtifacts}
            messageArtifacts={resolveArtifacts(message.artifacts)}
            activeArtifactId={activeArtifactId}
            onArtifactSelect={onArtifactSelect}
            copied={copied}
            onCopy={onCopy}
            speaking={speaking}
            onSpeak={onSpeak}
            onStopSpeak={onStopSpeak}
          />
        ))}
        {sending && (
          <article className="chat__turn chat__turn--assistant chat__turn--thinking">
            <div className="chat__thinking" aria-label={`${agentName} is responding`}>
              <span className="chat__thinking-dot chat__thinking-dot--1" />
              <span className="chat__thinking-dot chat__thinking-dot--2" />
              <span className="chat__thinking-dot chat__thinking-dot--3" />
            </div>
          </article>
        )}
        {workflowId && (
          <WorkflowSummary
            workflowId={workflowId}
            onOpenOperations={() => onOpenOperations?.(workflowId)}
            onSettled={onWorkflowSettled}
          />
        )}
      </div>
    </div>
  );
}
