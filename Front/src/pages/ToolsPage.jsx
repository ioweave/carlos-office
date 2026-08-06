import { useMemo, useState } from 'react';
import { IconBraces, IconPlayerPlay, IconShieldLock, IconTool } from '@tabler/icons-react';
import { toast } from 'sonner';
import api from '../api';

const defaultsFor = name => ({
    memory_search: { query: 'current operating decisions', limit: 8 },
    memory_read: { path: '90-System/Carlos Office Memory.md' },
    memory_list: { folder: '10-Shared', limit: 20 },
    memory_write: {
        title: 'Example durable memory',
        content: 'Replace this with a verified fact, decision, preference, procedure, or lesson.',
        scope: 'shared',
        tags: ['example'],
        mode: 'create',
    },
    web_search: { query: 'local AI agent architecture', maxResults: 5 },
    fetch_url: { url: 'https://example.com', maxChars: 6000 },
    project_list_files: { folder: 'Front/src', limit: 100 },
    project_read_file: { path: 'Front/src/App.jsx', maxChars: 30000 },
    project_search_files: { query: 'OfficeMapPage', folder: 'Front/src', limit: 20 },
    playwright_inspect_page: { url: 'http://127.0.0.1:5173', screenshot: true, label: 'office-inspection' },
    playwright_check_page: { url: 'http://127.0.0.1:5173', screenshot: true, label: 'office-check' },
    playwright_interact: {
        url: 'http://127.0.0.1:5173',
        steps: [{ action: 'click', text: 'Chat', exact: true }],
        screenshot: true,
        label: 'office-interaction',
    },
    current_time: { timeZone: 'America/Guayaquil' },
    list_ollama_models: {},
    list_agents: {},
    create_agent_job: {
        assignedAgent: 'iris',
        title: 'Research task',
        instructions: 'Research the defined question using primary sources.',
        expectedResult: 'A concise evidence-backed research brief with source URLs.',
        acceptanceCriteria: ['Uses primary sources', 'Separates facts from inference', 'Includes source URLs'],
        priority: 'normal',
        maxIterations: 2,
        autoRun: true,
    },
    get_agent_job: { jobId: '' },
    list_agent_jobs: { limit: 20 },
    retry_agent_job: { jobId: '' },
    cancel_agent_job: { jobId: '' },
    stop_all_agent_jobs: {},
    clear_agent_jobs: { scope: 'terminal' },
}[name] || {});

export default function ToolsPage({ tools }) {
    const [selected, setSelected] = useState('web_search');
    const [args, setArgs] = useState(JSON.stringify(defaultsFor('web_search'), null, 2));
    const [result, setResult] = useState('');
    const [running, setRunning] = useState(false);

    const tool = useMemo(() => tools.find(item => item.name === selected), [tools, selected]);

    const chooseTool = name => {
        setSelected(name);
        setResult('');
        setArgs(JSON.stringify(defaultsFor(name), null, 2));
    };

    const run = async () => {
        setRunning(true);
        try {
            const parsed = JSON.parse(args || '{}');
            const response = await api.post(`/tools/${selected}`, { agentId: 'nora', args: parsed });
            setResult(JSON.stringify(response.data, null, 2));
        } catch (error) {
            const message = error instanceof SyntaxError
                ? 'Arguments are not valid JSON.'
                : (error.response?.data?.error || error.message);
            toast.error(message);
            setResult(JSON.stringify({ error: message }, null, 2));
        } finally {
            setRunning(false);
        }
    };

    return (
        <div className="standard-page tools-page">
            <div className="page-header">
                <div>
                    <div className="eyebrow">Shared capability layer</div>
                    <h1>Tools</h1>
                    <p>The same controlled registry is supplied to office agents and the local stdio MCP server.</p>
                </div>
                <div className="security-note"><IconShieldLock size={17} /> Repository reads are scoped; browser automation is origin-restricted</div>
            </div>

            <div className="tools-layout">
                <section className="tool-list">
                    {tools.map(item => (
                        <button
                            type="button"
                            key={item.name}
                            className={`tool-list-item ${selected === item.name ? 'active' : ''}`}
                            onClick={() => chooseTool(item.name)}
                        >
                            <div className="tool-glyph"><IconTool size={18} /></div>
                            <div><strong>{item.name}</strong><span>{item.description}</span></div>
                        </button>
                    ))}
                </section>

                <section className="tool-console">
                    <div className="console-header">
                        <div><IconBraces size={20} /><div><strong>{tool?.name}</strong><span>Manual invocation as Nora</span></div></div>
                        <button type="button" className="primary-button" onClick={run} disabled={running || !tool}>
                            <IconPlayerPlay size={16} /> {running ? 'Running…' : 'Run tool'}
                        </button>
                    </div>
                    <label className="code-field">
                        <span>Arguments</span>
                        <textarea value={args} onChange={event => setArgs(event.target.value)} spellCheck="false" />
                    </label>
                    <label className="code-field result-field">
                        <span>Result</span>
                        <pre>{result || 'Tool output will appear here.'}</pre>
                    </label>
                </section>
            </div>
        </div>
    );
}
