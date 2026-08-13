import { useCallback, useEffect, useState } from 'react';
import { Toaster, toast } from 'sonner';
import api from './api';
import Sidebar from './components/Sidebar';
import ChatPage from './pages/ChatPage';
import OfficeMapPage from './pages/OfficeMapPage';
import ToolsPage from './pages/ToolsPage';
import SkillsPage from './pages/SkillsPage';
import SettingsPage from './pages/SettingsPage';
import AuthorizationsPage from './pages/AuthorizationsPage';
import ProcessesPage from './pages/ProcessesPage';
import AgentsPage from './pages/AgentsPage';
import OperationsPage from './pages/OperationsPage';

export default function App() {
    const [active, setActiveState] = useState(() => {
        const stored = localStorage.getItem('office-active-page') || 'chat';
        return ['chat', 'map', 'processes', 'agents', 'tools', 'skills', 'authorizations', 'operations', 'settings'].includes(stored) ? stored : 'chat';
    });
    const [theme, setThemeState] = useState(localStorage.getItem('office-theme') || 'light');
    const [health, setHealth] = useState(null);
    const [agents, setAgents] = useState([]);
    const [tools, setTools] = useState([]);
    const [loading, setLoading] = useState(true);
    const [chatRequest, setChatRequest] = useState(null);

    const setActive = value => {
        setActiveState(value);
        localStorage.setItem('office-active-page', value);
    };

    const setTheme = value => {
        setThemeState(value);
        localStorage.setItem('office-theme', value);
        document.documentElement.dataset.theme = value;
    };

    const load = useCallback(async () => {
        try {
            const [healthResponse, agentsResponse, toolsResponse] = await Promise.all([
                api.get('/health'),
                api.get('/agents'),
                api.get('/tools'),
            ]);
            setHealth(healthResponse.data);
            setAgents(agentsResponse.data || []);
            setTools(toolsResponse.data || []);
        } catch (error) {
            toast.error(error.response?.data?.error || 'Carlos Office backend is unavailable.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        load();
        const timer = setInterval(async () => {
            try { setHealth((await api.get('/health')).data); } catch {}
        }, 15000);
        return () => clearInterval(timer);
    }, [load, theme]);

    const openConversationFromMap = conversationId => {
        setChatRequest({ conversationId, token: Date.now() });
        setActive('chat');
    };

    const updateAgentState = updated => {
        setAgents(current => current.some(agent => agent.agentId === updated.agentId) ? current.map(agent => agent.agentId === updated.agentId ? updated : agent) : [...current, updated].sort((a, b) => a.name.localeCompare(b.name)));
    };

    const secondaryPage = {
        map: <OfficeMapPage onOpenConversation={openConversationFromMap} onAgentSaved={updateAgentState} />,
        agents: <AgentsPage agents={agents} onAgentSaved={updateAgentState} />,
        tools: <ToolsPage tools={tools} />,
        skills: <SkillsPage />,
        settings: <SettingsPage health={health} />,
        authorizations: <AuthorizationsPage />,
        processes: <ProcessesPage />,
        operations: <OperationsPage />,
    }[active] || null;

    return (
        <div className="office-shell">
            <Sidebar active={active} setActive={setActive} health={health} theme={theme} setTheme={setTheme} />
            <main className="office-shell__main">
                {loading ? (
                    <div className="office-shell__loading">
                        <div className="loader" />
                        <span>Starting Carlos Office…</span>
                    </div>
                ) : (
                    <>
                        <div className="office-shell__page" hidden={active !== 'chat'}>
                            <ChatPage agents={agents} health={health} openRequest={chatRequest} />
                        </div>
                        {active !== 'chat' && secondaryPage}
                    </>
                )}
            </main>
            <Toaster richColors theme={theme === 'light' ? 'light' : 'dark'} position="bottom-right" />
        </div>
    );
}
