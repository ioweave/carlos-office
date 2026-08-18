import { useEffect, useMemo, useState } from "react";
import { IconDownload, IconFile, IconX } from "@tabler/icons-react";
import api, { endpoints } from "../api";
import MarkdownMessage from "./MarkdownMessage";

const TEXT_PREFIXES = ["text/"];
const CODE_MIMES = new Set([
  "application/javascript", "text/javascript",
  "application/typescript", "text/typescript",
  "text/css", "text/x-css",
  "application/xml", "text/xml",
  "application/x-sh", "application/sql",
]);
const CODE_EXT = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".css", ".scss", ".xml", ".sh", ".py", ".go", ".rs", ".java", ".c", ".h", ".cpp", ".rb", ".php", ".yml", ".yaml", ".toml", ".ini", ".sql", ".lua", ".kt", ".swift", ".vue"];

const kindFor = (artifact) => {
  const type = String(artifact.type || "").toLowerCase();
  const name = String(artifact.name || "").toLowerCase();
  if (type.startsWith("image/") && type !== "image/svg+xml") return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  if (type === "application/pdf") return "pdf";
  if (type === "image/svg+xml" || type === "text/html") return "html";
  if (type === "text/markdown" || name.endsWith(".md")) return "markdown";
  if (type === "application/json" || name.endsWith(".json")) return "json";
  if (CODE_MIMES.has(type) || CODE_EXT.some(ext => name.endsWith(ext))) return "code";
  if (TEXT_PREFIXES.some(prefix => type.startsWith(prefix))) return "text";
  return "generic";
};

export default function ArtifactPreview({ conversationId, artifact, artifacts, onSelect, onClose }) {
  const [blobUrl, setBlobUrl] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const kind = artifact ? kindFor(artifact) : "generic";
  const textish = ["markdown", "json", "text", "code"].includes(kind);

  useEffect(() => {
    if (!artifact || !conversationId || kind === "generic") return undefined;
    let revoked = false;
    setBlobUrl("");
    setText("");
    setError("");
    setLoading(true);

    api.get(endpoints.conversationArtifact(conversationId, artifact.id), { responseType: "blob" })
      .then(async response => {
        if (revoked) return;
        const blob = response.data;
        if (textish) {
          setText(await blob.text());
        } else {
          setBlobUrl(URL.createObjectURL(blob));
        }
      })
      .catch(fetchError => {
        if (!revoked) setError(fetchError.response?.data?.error || fetchError.message || "Could not load artifact.");
      })
      .finally(() => { if (!revoked) setLoading(false); });

    return () => {
      revoked = true;
      setBlobUrl(current => { if (current) URL.revokeObjectURL(current); return ""; });
    };
    // Re-fetch only when the artifact identity or preview kind changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact?.id, conversationId, kind]);

  const downloadUrl = useMemo(() => {
    if (!artifact || !conversationId) return "";
    return `${api.defaults.baseURL}${endpoints.conversationArtifact(conversationId, artifact.id)}`;
  }, [artifact, conversationId]);

  if (!artifact) return null;

  return (
    <aside className="chat-artifact" aria-label="Generated artifact preview">
      <header className="chat-artifact__header">
        <div className="chat-artifact__identity">
          <IconFile size={17} />
          <div>
            <strong className="chat-artifact__name">{artifact.name}</strong>
            <span className="chat-artifact__path">{artifact.path || artifact.type || "file"}</span>
          </div>
        </div>
        <div className="chat-artifact__actions">
          <a className="icon-button" href={downloadUrl} download={artifact.name} aria-label="Download artifact" title="Download"><IconDownload size={17} /></a>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close artifact preview" title="Close"><IconX size={18} /></button>
        </div>
      </header>

      {artifacts && artifacts.length > 1 && (
        <label className="chat-artifact__selector">
          <span>Artifact</span>
          <select value={artifact.id} onChange={event => onSelect(event.target.value)}>
            {artifacts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      )}

      <div className="chat-artifact__meta">
        <span>{kind}</span>
        <span>{artifact.type || "file"}</span>
        <span>{artifact.createdBy || "office"}</span>
      </div>

      <div className={`chat-artifact__body chat-artifact__body--${kind}`}>
        {loading && <div className="chat-artifact__status">Loading preview…</div>}
        {!loading && error && <div className="chat-artifact__status chat-artifact__status--error"><strong>Preview unavailable</strong><p>{error}</p></div>}
        {!loading && !error && kind === "image" && blobUrl && <img className="chat-artifact__image" src={blobUrl} alt={artifact.name} />}
        {!loading && !error && kind === "pdf" && blobUrl && <iframe className="chat-artifact__frame" src={blobUrl} title={artifact.name} />}
        {!loading && !error && kind === "audio" && blobUrl && <audio className="chat-artifact__audio" controls preload="metadata" src={blobUrl}>Audio unsupported.</audio>}
        {!loading && !error && kind === "video" && blobUrl && <video className="chat-artifact__video" controls playsInline preload="metadata" src={blobUrl}>Video unsupported.</video>}
        {!loading && !error && kind === "html" && blobUrl && <iframe className="chat-artifact__frame" sandbox="" src={blobUrl} title={artifact.name} />}
        {!loading && !error && kind === "markdown" && <div className="chat-artifact__markdown"><MarkdownMessage content={text} /></div>}
        {!loading && !error && ["code", "json", "text"].includes(kind) && <pre className="chat-artifact__code">{text}</pre>}
        {kind === "generic" && (
          <div className="chat-artifact__generic">
            <IconFile size={28} />
            <strong className="chat-artifact__generic-title">{artifact.name}</strong>
            <span className="chat-artifact__generic-meta">{artifact.type || "Unknown binary"}</span>
            {artifact.createdBy && <span className="chat-artifact__generic-meta">Created by {artifact.createdBy}</span>}
            {artifact.size != null && <span className="chat-artifact__generic-meta">{artifact.size} bytes</span>}
            <a className="primary-button" href={downloadUrl} download={artifact.name}><IconDownload size={15} /> Download file</a>
            <p className="chat-artifact__notice">This file type cannot be previewed inline. Download it to open with a compatible application.</p>
          </div>
        )}
      </div>
    </aside>
  );
}