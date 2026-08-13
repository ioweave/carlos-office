import {
    IconAdjustments,
    IconBrain,
    IconChartHistogram,
    IconMessages,
    IconMoon,
    IconSun,
    IconSparkles,
    IconTool,
    IconGitBranch,
    IconKey,
    IconUsersGroup,
} from '@tabler/icons-react';

const items = [
    { id: 'chat', label: 'Chat', icon: IconMessages },
    { id: 'map', label: 'Office map', icon: IconBrain },
    { id: 'processes', label: 'Processes', icon: IconGitBranch },
    { id: 'agents', label: 'Agents', icon: IconUsersGroup },
    { id: 'tools', label: 'Tools', icon: IconTool },
    { id: 'skills', label: 'Skills', icon: IconSparkles },
    { id: 'authorizations', label: 'Authorizations', icon: IconKey },
    { id: 'operations', label: 'Operations', icon: IconChartHistogram },
    { id: 'settings', label: 'Settings', icon: IconAdjustments },
];

export default function Sidebar({ active, setActive, health, theme, setTheme }) {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    const working = health?.work?.active || health?.processes?.active || 0;

    return (
        <aside className="office-nav">
            <button className="office-nav__brand" onClick={() => setActive('chat')} aria-label="Open Carlos Office chat">
                <span className="office-nav__mark">C</span>
                <strong>Carlos Office</strong>
            </button>

            <nav className="office-nav__menu" aria-label="Office navigation">
                {items.map(item => {
                    const Icon = item.icon;
                    const current = active === item.id;

                    return (
                        <button
                            key={item.id}
                            className={`office-nav__item ${current ? 'office-nav__item--active' : ''}`}
                            onClick={() => setActive(item.id)}
                            aria-label={item.label}
                            aria-current={current ? 'page' : undefined}
                        >
                            <Icon size={19} stroke={1.7} />
                            <span>{item.label}</span>
                            {item.id === 'map' && working > 0 && <small className="office-nav__count">{working}</small>}
                        </button>
                    );
                })}
            </nav>

            <div className="office-nav__footer">
                <div className="office-nav__status">
                    <span className={`office-nav__status-dot ${health?.status === 'online' ? 'office-nav__status-dot--online' : ''}`} />
                    <div>
                        <strong>{working ? `${working} agent${working === 1 ? '' : 's'} working` : (health?.status === 'online' ? 'Office ready' : 'Office unavailable')}</strong>
                        <span>{health?.ollama?.online ? 'Ollama connected' : 'Ollama offline'}</span>
                    </div>
                </div>

                <button className="office-nav__theme" onClick={() => setTheme(nextTheme)} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
                    {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
                    <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
                </button>
            </div>
        </aside>
    );
}
