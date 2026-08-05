import { useCallback, useEffect, useState } from 'react';
import { Toaster, toast } from 'sonner';
import api from './api';
import Sidebar from './components/Sidebar';
import ChatPage from './pages/ChatPage';
import AgentsPage from './pages/AgentsPage';
import JobsPage from './pages/JobsPage';
import ToolsPage from './pages/ToolsPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
    const [active, setActive] = useState('chat');
    const [theme, setThemeState] = useState(localStorage.getItem('office-theme') || 'dark');
    const [health, setHealth] = useState(null);
    const [agents, setAgents] = useState([]);
    const [tools, setTools] = useState([]);
    const [loading, setLoading] = useState(true);

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

    const page = {
        chat: <ChatPage agents={agents} health={health} />,
        agents: <AgentsPage agents={agents} setAgents={setAgents} />,
        jobs: <JobsPage />,
        tools: <ToolsPage tools={tools} />,
        settings: <SettingsPage health={health} />,
    }[active];

    return (
        <div className="app-shell">
            <Sidebar active={active} setActive={setActive} health={health} theme={theme} setTheme={setTheme} />
            <main className="main-content">
                {loading ? <div className="loading-screen"><div className="loader" /><span>Starting Carlos Office…</span></div> : page}
            </main>
            <Toaster richColors theme={theme === 'light' ? 'light' : 'dark'} position="bottom-right" />
        </div>
    );
}
