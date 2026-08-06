import { IconCloud, IconDatabase, IconKey, IconLock, IconMicrophone, IconServer, IconTerminal2 } from '@tabler/icons-react';

export default function SettingsPage({ health }) {
    return (
        <div className="standard-page settings-page">
            <div className="page-header">
                <div><div className="eyebrow">Local deployment</div><h1>Settings</h1><p>Runtime values remain environment-based and persistent state stays in the local Obsidian vault.</p></div>
            </div>

            <div className="settings-grid">
                <article className="settings-card"><IconLock /><div><h3>No login</h3><p>The backend binds to <code>127.0.0.1</code> by default. Do not expose it publicly without authentication.</p></div></article>
                <article className="settings-card"><IconServer /><div><h3>Ollama</h3><p>{health?.ollama?.online ? `Online with ${health.ollama.models} installed or registered models.` : 'Offline. Start Ollama before chatting with agents.'}</p></div></article>
                <article className="settings-card"><IconCloud /><div><h3>Model routing</h3><p><code>minimax-m3:cloud</code> is primary. <code>qwen3:8b</code> is used only for connectivity failures.</p></div></article>
                <article className="settings-card"><IconDatabase /><div><h3>Obsidian-only state</h3><p>Conversations, memory, jobs, and agent settings are Markdown files. No MongoDB service is used.</p></div></article>
                <article className="settings-card"><IconMicrophone /><div><h3>Browser voice</h3><p>Speech output uses browser or operating-system voices. Recognition support depends on the browser and may use its speech service.</p></div></article>
                <article className="settings-card"><IconKey /><div><h3>Optional credentials</h3><p>Non-Ollama provider keys are read from backend environment variables and are never stored in the browser.</p></div></article>
                <article className="settings-card span-2"><IconTerminal2 /><div><h3>MCP stdio server</h3><p>Run <code>cd Back && npm run mcp</code> to expose the shared local tool registry to an MCP-compatible host.</p></div></article>
            </div>
        </div>
    );
}
