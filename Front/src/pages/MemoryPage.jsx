import { useEffect, useState } from 'react';
import {
    IconDatabase,
    IconDeviceFloppy,
    IconFileText,
    IconFolder,
    IconPlus,
    IconSearch,
} from '@tabler/icons-react';
import { toast } from 'sonner';
import api from '../api';
import '../memory.scss';

const emptyEditor = {
    title: '',
    content: '',
    scope: 'shared',
    tags: '',
    path: '',
};

const displayDate = value => value ? new Date(value).toLocaleString() : '';

export default function MemoryPage({ health }) {
    const [notes, setNotes] = useState([]);
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState(null);
    const [editor, setEditor] = useState(emptyEditor);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const loadNotes = async search => {
        setLoading(true);
        try {
            const response = await api.get('/memory', {
                params: { query: search || undefined, limit: 150 },
            });
            setNotes(response.data || []);
        } catch (error) {
            toast.error(error.response?.data?.error || 'Could not load permanent memory.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadNotes(''); }, []);

    const openNote = async note => {
        try {
            const response = await api.get('/memory/read', { params: { path: note.path } });
            const full = response.data;
            setSelected(full);
            setEditor({
                title: full.title || '',
                content: full.content || '',
                scope: full.scope === 'shared' ? 'shared' : 'agent',
                tags: (full.tags || []).join(', '),
                path: full.path,
            });
        } catch (error) {
            toast.error(error.response?.data?.error || 'Could not read the memory note.');
        }
    };

    const newNote = () => {
        setSelected(null);
        setEditor(emptyEditor);
    };

    const save = async () => {
        if (!editor.title.trim() || !editor.content.trim()) {
            toast.error('Title and content are required.');
            return;
        }
        setSaving(true);
        try {
            const response = await api.post('/memory', {
                agentId: 'nora',
                title: editor.title,
                content: editor.content,
                scope: editor.scope,
                tags: editor.tags.split(',').map(tag => tag.trim()).filter(Boolean),
                path: editor.path,
                mode: editor.path ? 'replace' : 'create',
                source: 'carlos-office-ui',
            });
            const note = response.data;
            setSelected(note);
            setEditor(current => ({ ...current, path: note.path }));
            toast.success('Permanent memory saved.');
            await loadNotes(query);
        } catch (error) {
            toast.error(error.response?.data?.error || 'Could not save permanent memory.');
        } finally {
            setSaving(false);
        }
    };

    const runSearch = event => {
        event?.preventDefault();
        loadNotes(query.trim());
    };

    return (
        <div className="standard-page memory-page">
            <div className="page-header memory-header">
                <div>
                    <div className="eyebrow">Permanent institutional memory</div>
                    <h1>Obsidian Memory</h1>
                    <p>Nora and every worker agent search this Markdown vault automatically before each model run.</p>
                </div>
                <div className="memory-status">
                    <IconDatabase size={18} />
                    <div>
                        <strong>{health?.memory?.notes || 0} notes</strong>
                        <span title={health?.memory?.path}>{health?.memory?.path || 'Vault unavailable'}</span>
                    </div>
                </div>
            </div>

            <div className="memory-layout">
                <section className="memory-browser">
                    <form className="memory-search" onSubmit={runSearch}>
                        <IconSearch size={18} />
                        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search decisions, clients, procedures…" />
                        <button className="secondary-button" type="submit">Search</button>
                    </form>
                    <div className="memory-list-header">
                        <span>{loading ? 'Loading…' : `${notes.length} notes`}</span>
                        <button className="secondary-button" onClick={newNote}><IconPlus size={16} /> New note</button>
                    </div>
                    <div className="memory-list">
                        {!loading && !notes.length && <div className="memory-empty">No matching memories.</div>}
                        {notes.map(note => (
                            <button
                                key={note.path}
                                className={`memory-list-item ${selected?.path === note.path ? 'active' : ''}`}
                                onClick={() => openNote(note)}
                            >
                                <IconFileText size={18} />
                                <div>
                                    <strong>{note.title}</strong>
                                    <span>{note.path}</span>
                                    <small>{displayDate(note.modifiedAt)}</small>
                                </div>
                            </button>
                        ))}
                    </div>
                </section>

                <section className="memory-editor">
                    <div className="memory-editor-header">
                        <div>
                            <div className="memory-note-path"><IconFolder size={16} /> {editor.path || 'New Markdown note'}</div>
                            <h2>{editor.path ? 'Edit memory' : 'Create memory'}</h2>
                        </div>
                        <button className="primary-button" onClick={save} disabled={saving}>
                            <IconDeviceFloppy size={17} /> {saving ? 'Saving…' : 'Save memory'}
                        </button>
                    </div>

                    <div className="memory-form-grid">
                        <label className="memory-title-field">
                            <span>Title</span>
                            <input value={editor.title} onChange={event => setEditor({ ...editor, title: event.target.value })} placeholder="Durable fact or decision" />
                        </label>
                        <label>
                            <span>Scope</span>
                            <select value={editor.scope} onChange={event => setEditor({ ...editor, scope: event.target.value })} disabled={Boolean(editor.path)}>
                                <option value="shared">Shared company memory</option>
                                <option value="agent">Nora's agent memory</option>
                                <option value="inbox">Memory inbox</option>
                            </select>
                        </label>
                        <label className="memory-tags-field">
                            <span>Tags</span>
                            <input value={editor.tags} onChange={event => setEditor({ ...editor, tags: event.target.value })} placeholder="client, decision, process" />
                        </label>
                        <label className="memory-content-field">
                            <span>Markdown content</span>
                            <textarea value={editor.content} onChange={event => setEditor({ ...editor, content: event.target.value })} placeholder="Write permanent knowledge here…" spellCheck="true" />
                        </label>
                    </div>

                    <div className="memory-guidance">
                        <strong>Stored permanently as Markdown.</strong>
                        <span>Open the displayed vault path in Obsidian to organize, link, and edit these notes directly. Conversation journals are written automatically under <code>30-Conversations</code>.</span>
                    </div>
                </section>
            </div>
        </div>
    );
}
