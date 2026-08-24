import { useEffect, useMemo, useState } from "react";
import {
  IconDownload,
  IconEye,
  IconFile,
  IconX,
} from "@tabler/icons-react";

import api, { endpoints } from "../api";
import MarkdownContent from "./MarkdownContent";

const TEXT_TYPES = new Set([
  "application/json",
  "application/javascript",
  "application/sql",
  "application/xml",
  "text/javascript",
  "text/typescript",
]);
const TEXT_EXTENSIONS = [
  ".c", ".cpp", ".css", ".go", ".h", ".ini", ".java", ".js", ".json", ".jsx", ".kt",
  ".lua", ".mjs", ".php", ".py", ".rb", ".rs", ".scss", ".sh", ".sql", ".swift", ".toml",
  ".ts", ".tsx", ".txt", ".vue", ".xml", ".yaml", ".yml",
];

const previewKind = artifact => {
  const type = String(artifact?.type || "").toLowerCase();
  const name = String(artifact?.name || "").toLowerCase();
  if (type === "text/markdown" || name.endsWith(".md")) return "markdown";
  if (type === "text/html" || name.endsWith(".html") || name.endsWith(".htm")) return "html";
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("text/") || TEXT_TYPES.has(type) || TEXT_EXTENSIONS.some(ext => name.endsWith(ext))) {
    return "text";
  }
  return null;
};

export default function ArtifactPanel({ conversationId, artifact, onClose }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPreview, setShowPreview] = useState(true);
  const kind = previewKind(artifact);
  const artifactPath = artifact && conversationId
    ? endpoints.conversationArtifact(conversationId, artifact.id)
    : "";
  const url = artifactPath ? `${api.defaults.baseURL}${artifactPath}` : "";
  const downloadUrl = url ? `${url}?download=1` : "";
  const needsText = kind === "text" || kind === "markdown";

  useEffect(() => {
    setShowPreview(true);
  }, [artifact?.id]);

  useEffect(() => {
    if (!artifact || !needsText || !artifactPath) {
      setText("");
      setError("");
      setLoading(false);
      return undefined;
    }

    let active = true;
    setLoading(true);
    setError("");
    api.get(artifactPath, { responseType: "text", transformResponse: [value => value] })
      .then(response => {
        if (active) setText(typeof response.data === "string" ? response.data : String(response.data ?? ""));
      })
      .catch(fetchError => {
        if (active) setError(fetchError.response?.data?.error || "Could not preview this Artifact.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [artifact?.id, artifactPath, needsText]);

  useEffect(() => {
    if (!artifact) return undefined;
    const onKeyDown = event => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [artifact, onClose]);

  const preview = useMemo(() => {
    if (!artifact) return null;
    if (!kind) {
      return (
        <div className="artifact-panel__empty">
          <IconFile size={28} stroke={1.4} />
          <strong>Preview unavailable</strong>
          <span>This binary Artifact can still be downloaded.</span>
        </div>
      );
    }
    if (loading) return <div className="artifact-panel__state"><span className="spinner" /> Loading preview…</div>;
    if (error) return <div className="artifact-panel__state artifact-panel__state--error">{error}</div>;
    if (kind === "markdown") return <div className="artifact-panel__text"><MarkdownContent>{text}</MarkdownContent></div>;
    if (kind === "text") return <pre className="artifact-panel__code">{text}</pre>;
    if (kind === "html") return <iframe className="artifact-panel__frame" src={url} sandbox="" title={artifact.name} />;
    if (kind === "pdf") return <iframe className="artifact-panel__frame" src={url} title={artifact.name} />;
    if (kind === "image") return <div className="artifact-panel__media"><img src={url} alt={artifact.name} /></div>;
    if (kind === "audio") return <div className="artifact-panel__media"><audio src={url} controls /></div>;
    if (kind === "video") return <div className="artifact-panel__media"><video src={url} controls /></div>;
    return null;
  }, [artifact, kind, loading, error, text, url]);

  if (!artifact) return null;

  return (
    <aside className="artifact-panel" aria-label={`Artifact ${artifact.name}`}>
      <header className="artifact-panel__header">
        <div className="artifact-panel__identity">
          <span className="eyebrow">Artifact</span>
          <h2>{artifact.name}</h2>
          <small>{artifact.type || "application/octet-stream"}</small>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close Artifact panel">
          <IconX size={18} />
        </button>
      </header>
      <div className="artifact-panel__actions">
        <button
          type="button"
          className="button button--quiet"
          disabled={!kind}
          onClick={() => setShowPreview(true)}
        >
          <IconEye size={14} /> Preview
        </button>
        <a className="button button--quiet" href={downloadUrl}>
          <IconDownload size={14} /> Download
        </a>
      </div>
      <div className="artifact-panel__body">{showPreview ? preview : null}</div>
    </aside>
  );
}
