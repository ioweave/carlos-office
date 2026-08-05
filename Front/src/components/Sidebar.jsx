import {
    IconAdjustments,
    IconBriefcase2,
    IconDatabase,
    IconMessages,
    IconMoon,
    IconRobot,
    IconSun,
    IconTool,
} from '@tabler/icons-react';

const items = [
    { id: 'chat', label: 'Nora', icon: IconMessages },
    { id: 'agents', label: 'Agents', icon: IconRobot },
    { id: 'jobs', label: 'Jobs', icon: IconBriefcase2 },
    { id: 'tools', label: 'MCP Tools', icon: IconTool },
    { id: 'memory', label: 'Memory', icon: IconDatabase },
    { id: 'settings', label: 'Settings', icon: IconAdjustments },
];

export default function Sidebar({ active, setActive, health, theme, setTheme }) {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';

    return (
        <aside className="sidebar">
            <div className="brand">
                <div className="brand-mark">C</div>
                <div>
                    <strong>Carlos Office</strong>
                    <span>Mer1dian control room</span>
                </div>
            </div>

            <nav className="nav-list">
                {items.map(item => {
                    const Icon = item.icon;
                    return (
                        <button
                            key={item.id}
                            className={`nav-item ${active === item.id ? 'active' : ''}`}
                            onClick={() => setActive(item.id)}
                        >
                            <Icon size={19} stroke={1.7} />
                            <span>{item.label}</span>
                        </button>
                    );
                })}
            </nav>

            <div className="sidebar-footer">
                <div className="system-card">
                    <span className={`live-dot ${health?.status === 'online' ? 'online' : ''}`} />
                    <div>
                        <strong>{health?.status === 'online' ? 'Office online' : 'Office unavailable'}</strong>
                        <span>{health?.ollama?.online ? `${health.ollama.models} Ollama models` : 'Ollama offline'}</span>
                    </div>
                </div>
                <button className="theme-button" onClick={() => setTheme(nextTheme)}>
                    {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
                    {theme === 'dark' ? 'Light mode' : 'Dark mode'}
                </button>
            </div>
        </aside>
    );
}
