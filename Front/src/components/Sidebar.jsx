import {
    IconAdjustments,
    IconBriefcase2,
    IconBrain,
    IconDatabase,
    IconMessages,
    IconMoon,
    IconRobot,
    IconSun,
    IconTool,
} from '@tabler/icons-react';

const items = [
    { id: 'chat', label: 'Chat', icon: IconMessages },
    { id: 'map', label: 'Office map', icon: IconBrain },
    { id: 'agents', label: 'Agents', icon: IconRobot },
    { id: 'jobs', label: 'Jobs', icon: IconBriefcase2 },
    { id: 'memory', label: 'Memory', icon: IconDatabase },
    { id: 'tools', label: 'Tools', icon: IconTool },
    { id: 'settings', label: 'Settings', icon: IconAdjustments },
];

export default function Sidebar({ active, setActive, health, theme, setTheme }) {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    const working = health?.jobs?.active?.length || 0;

    return (
        <aside className="sidebar">
            <button className="brand" onClick={() => setActive('chat')} aria-label="Open Carlos Office chat">
                <div className="brand-mark">C</div>
                <div>
                    <strong>Carlos Office</strong>
                    <span>Private local operations</span>
                </div>
            </button>

            <nav className="nav-list" aria-label="Office navigation">
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
                            {item.id === 'map' && working > 0 && <small className="nav-count">{working}</small>}
                        </button>
                    );
                })}
            </nav>

            <div className="sidebar-footer">
                <div className="system-card">
                    <span className={`live-dot ${health?.status === 'online' ? 'online' : ''}`} />
                    <div>
                        <strong>{working ? `${working} agent${working === 1 ? '' : 's'} working` : (health?.status === 'online' ? 'Office ready' : 'Office unavailable')}</strong>
                        <span>{health?.ollama?.online ? 'Ollama connected' : 'Ollama offline'}</span>
                    </div>
                </div>
                <button className="theme-button" onClick={() => setTheme(nextTheme)}>
                    {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
                    <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
                </button>
            </div>
        </aside>
    );
}
