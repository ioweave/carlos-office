import { useEffect, useMemo, useState } from 'react';
import { IconDownload, IconFile, IconX } from '@tabler/icons-react';
import { toast } from 'sonner';
import api from '../api';
import MarkdownMessage from './MarkdownMessage';

const bytes = value => value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 ** 2).toFixed(1)} MB`;

const downloadRecord = record => {
    const blob = record.encoding === 'base64'
        ? new Blob([Uint8Array.from(atob(record.data || ''), character => character.charCodeAt(0))], { type: record.mimeType || 'application/octet-stream' })
        : new Blob([record.content || ''], { type: record.mimeType || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = record.name || 'artifact';
    link.click();
    URL.revokeObjectURL(url);
};

export default function ArtifactPreview({ artifact, artifacts, onSelect, onClose }) {
    const [record, setRecord] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let disposed = false;
        setRecord(null);
        setError('');
        if (!artifact) return () => { disposed = true; };
        setLoading(true);
        api.get('/artifacts/read', { params: { source: artifact.source, path: artifact.path, agentId: artifact.agentId || 'nora' } })
            .then(response => { if (!disposed) setRecord({ ...artifact, ...response.data }); })
            .catch(requestError => { if (!disposed) setError(requestError.response?.data?.error || requestError.message || 'Could not load artifact.'); })
            .finally(() => { if (!disposed) setLoading(false); });
        return () => { disposed = true; };
    }, [artifact?.artifactId]);

    const dataUrl = useMemo(() => record?.encoding === 'base64' && record?.data
        ? `data:${record.mimeType || 'application/octet-stream'};base64,${record.data}`
        : '', [record]);

    if (!artifact) return null;

    return (
        <aside className="chat-artifact" aria-label="Generated artifact preview">
            <header className="chat-artifact__header">
                <div className="chat-artifact__identity">
                    <IconFile size={17} />
                    <div>
                        <strong>{artifact.title || artifact.name}</strong>
                        <span>{artifact.path}</span>
                    </div>
                </div>
                <div className="chat-artifact__actions">
                    {record && <button type="button" onClick={() => downloadRecord(record)} aria-label="Download artifact" title="Download"><IconDownload size={17} /></button>}
                    <button type="button" onClick={onClose} aria-label="Close artifact preview" title="Close"><IconX size={18} /></button>
                </div>
            </header>

            {artifacts.length > 1 && (
                <label className="chat-artifact__selector">
                    <span>Artifact</span>
                    <select value={artifact.artifactId} onChange={event => onSelect(event.target.value)}>
                        {artifacts.map(item => <option key={item.artifactId} value={item.artifactId}>{item.title || item.name}</option>)}
                    </select>
                </label>
            )}

            <div className="chat-artifact__meta">
                <span>{artifact.previewKind}</span>
                <span>{artifact.mimeType}</span>
                {!!artifact.size && <span>{bytes(artifact.size)}</span>}
                <span>{artifact.source}</span>
            </div>

            <div className="chat-artifact__body">
                {loading && <div className="chat-artifact__status">Loading preview…</div>}
                {!loading && error && <div className="chat-artifact__status chat-artifact__status--error"><strong>Preview unavailable</strong><p>{error}</p></div>}
                {!loading && !error && record?.previewKind === 'image' && dataUrl && <img className="chat-artifact__image" src={dataUrl} alt={record.title || record.name || 'Generated artifact'} />}
                {!loading && !error && record?.previewKind === 'pdf' && dataUrl && <iframe className="chat-artifact__frame" src={dataUrl} title={record.title || record.name} />}
                {!loading && !error && record?.previewKind === 'html' && <iframe className="chat-artifact__frame" sandbox="" srcDoc={record.content || ''} title={record.title || record.name} />}
                {!loading && !error && record?.previewKind === 'markdown' && <div className="chat-artifact__markdown"><MarkdownMessage content={record.content || ''} /></div>}
                {!loading && !error && ['code', 'json', 'text'].includes(record?.previewKind) && <pre className="chat-artifact__code">{record.content || ''}</pre>}
                {!loading && !error && record && !['image', 'pdf', 'html', 'markdown', 'code', 'json', 'text'].includes(record.previewKind) && <pre className="chat-artifact__code">{record.content || 'No inline preview is available for this artifact.'}</pre>}
                {!loading && !error && record?.truncated && <div className="chat-artifact__notice">Preview truncated for safety. Download the artifact to view the complete file.</div>}
            </div>
        </aside>
    );
}
