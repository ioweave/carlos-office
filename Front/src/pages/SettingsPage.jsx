import { IconDatabase, IconKey, IconLock, IconServer, IconTerminal2 } from '@tabler/icons-react';

export default function SettingsPage({ health }) {
    return (
        <div className="standard-page settings-page">
            <div className="page-header">
                <div><div className="eyebrow">Local deployment</div><h1>Settings</h1><p>Runtime values and office data remain on your machine.</p></div>
            </div>

            <div className="settings-grid">
                <article className="settings-card"><IconLock /><div><h3>No login</h3><p>The backend binds to <code>127.0.0.1</code> by default. Do not expose it publicly without adding authentication.</p></div></article>
                <article className="settings-card"><IconServer /><div><h3>Ollama</h3><p>{health?.ollama?.online ? `Online with ${health.ollama.models} installed models.` : 'Offline. Start Ollama before chatting with local agents.'}</p></div></article>
                <article className="settings-card"><IconDatabase /><div><h3>Obsidian vault</h3><p>Memory, conversations, agent settings, and queued jobs are Markdown notes in <code>{health?.memory?.path || '~/CarlosOfficeVault'}</code>.</p></div></article>
                <article className="settings-card"><IconKey /><div><h3>Cloud credentials</h3><p>Optional API keys are read from backend environment variables; they are never written to the vault or browser.</p></div></article>
                <article className="settings-card span-2"><IconTerminal2 /><div><h3>MCP stdio server</h3><p>Run <code>cd Back && npm run mcp</code> to expose the shared tool registry to an MCP-compatible local host.</p></div></article>
            </div>
        </div>
    );
}
