import { useMemo, useState } from 'react';
import { IconBraces, IconPlayerPlay, IconShieldLock, IconTool } from '@tabler/icons-react';
import { toast } from 'sonner';
import api from '../api';

export default function ToolsPage({ tools }) {
    const [selected, setSelected] = useState('web_search');
    const [args, setArgs] = useState('{\n  "query": "latest developments in local AI agents",\n  "maxResults": 5\n}');
    const [result, setResult] = useState('');
    const [running, setRunning] = useState(false);

    const tool = useMemo(() => tools.find(item => item.name === selected), [tools, selected]);

    const chooseTool = name => {
        setSelected(name);
        setResult('');
        const defaults = {
            web_search: { query: 'Mer1dian market research', maxResults: 5 },
            fetch_url: { url: 'https://example.com', maxChars: 6000 },
            current_time: { timeZone: 'America/Guayaquil' },
            list_ollama_models: {},
            list_agents: {},
            create_agent_job: { assignedAgent: 'marco', title: 'Research task', instructions: 'Define the research scope.', priority: 'normal' },
        };
        setArgs(JSON.stringify(defaults[name] || {}, null, 2));
    };

    const run = async () => {
        setRunning(true);
        try {
            const parsed = JSON.parse(args || '{}');
            const response = await api.post(`/tools/${selected}`, { agentId: 'nora', args: parsed });
            setResult(JSON.stringify(response.data, null, 2));
        } catch (error) {
            const message = error instanceof SyntaxError ? 'Arguments are not valid JSON.' : (error.response?.data?.error || error.message);
            toast.error(message);
            setResult(JSON.stringify({ error: message }, null, 2));
        } finally {
            setRunning(false);
        }
    };

    return (
        <div className="standard-page tools-page">
            <div className="page-header">
                <div><div className="eyebrow">Shared capability layer</div><h1>MCP Tools</h1><p>The same registry is available to office agents and the local stdio MCP server.</p></div>
                <div className="security-note"><IconShieldLock size={17} /> Private-network URLs are blocked</div>
            </div>

            <div className="tools-layout">
                <section className="tool-list">
                    {tools.map(item => (
                        <button key={item.name} className={`tool-list-item ${selected === item.name ? 'active' : ''}`} onClick={() => chooseTool(item.name)}>
                            <div className="tool-glyph"><IconTool size={18} /></div>
                            <div><strong>{item.name}</strong><span>{item.description}</span></div>
                        </button>
                    ))}
                </section>

                <section className="tool-console">
                    <div className="console-header">
                        <div><IconBraces size={20} /><div><strong>{tool?.name}</strong><span>Manual invocation as Nora</span></div></div>
                        <button className="primary-button" onClick={run} disabled={running}><IconPlayerPlay size={16} /> {running ? 'Running…' : 'Run tool'}</button>
                    </div>
                    <label className="code-field"><span>Arguments</span><textarea value={args} onChange={event => setArgs(event.target.value)} spellCheck="false" /></label>
                    <label className="code-field result-field"><span>Result</span><pre>{result || 'Tool output will appear here.'}</pre></label>
                </section>
            </div>
        </div>
    );
}
