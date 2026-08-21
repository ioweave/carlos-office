import { useState } from "react";
import {
  IconBrain,
  IconChartHistogram,
  IconDots,
  IconGitBranch,
  IconKey,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconMessages,
  IconMoon,
  IconSun,
  IconTool,
} from "@tabler/icons-react";
import BottomSheet from "./BottomSheet";

const items = [
  { id: "chat", label: "Chat", icon: IconMessages, primary: true },
  { id: "map", label: "Office map", icon: IconBrain, primary: true },
  { id: "processes", label: "Processes", icon: IconGitBranch, primary: true },
  { id: "operations", label: "Operations", icon: IconChartHistogram, primary: true },
  { id: "authorizations", label: "Authorizations", icon: IconKey, primary: false },
  { id: "capabilities", label: "Capabilities", icon: IconTool, primary: false },
];

const NavButton = ({ item, active, onSelect, collapsed }) => {
  const Icon = item.icon;
  const current = active === item.id;

  return (
    <button
      type="button"
      className={`office-nav__item ${current ? "office-nav__item--active" : ""} ${collapsed ? "office-nav__item--collapsed" : ""}`}
      onClick={() => onSelect(item.id)}
      aria-label={item.label}
      aria-current={current ? "page" : undefined}
      title={collapsed ? item.label : undefined}
    >
      <Icon size={19} stroke={1.7} />
      <span className={`office-nav__item-label ${collapsed ? "office-nav__item-label--collapsed" : ""}`}>
        {item.label}
      </span>
    </button>
  );
};

export default function Sidebar({
  active,
  setActive,
  connected,
  nora,
  effectiveTheme,
  setTheme,
  collapsed,
  setCollapsed,
  workingCount,
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const working = workingCount ?? 0;

  const select = id => {
    setActive(id);
    setMoreOpen(false);
  };

  const cycleTheme = () => setTheme(effectiveTheme === "dark" ? "light" : "dark");
  const secondaryActive = items.some(item => !item.primary && item.id === active);

  return (
    <aside className={`office-nav ${collapsed ? "office-nav--collapsed" : ""}`}>
      <div className={`office-nav__header ${collapsed ? "office-nav__header--collapsed" : ""}`}>
        <button
          type="button"
          className={`office-nav__brand ${collapsed ? "office-nav__brand--collapsed" : ""}`}
          onClick={() => setActive("chat")}
          aria-label="Open Carlos Office chat"
        >
          <span className="office-nav__mark">CO</span>
          <span className="office-nav__brand-copy">
            <strong className="office-nav__brand-name">Carlos Office</strong>
            <small className="office-nav__brand-tag">Multi-Agent OS</small>
          </span>
        </button>
        <button
          type="button"
          className="office-nav__toggle"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <IconLayoutSidebarLeftExpand size={18} /> : <IconLayoutSidebarLeftCollapse size={18} />}
        </button>
      </div>

      <nav className="office-nav__menu" aria-label="Office navigation">
        {items.filter(item => item.primary).map(item => (
          <NavButton key={item.id} item={item} active={active} onSelect={select} collapsed={collapsed} />
        ))}
        <button
          type="button"
          className={`office-nav__more ${secondaryActive ? "office-nav__item--active" : ""}`}
          onClick={() => setMoreOpen(true)}
          aria-label="More navigation"
        >
          <IconDots size={19} stroke={1.7} />
        </button>
        {items.filter(item => !item.primary).map(item => (
          <NavButton key={item.id} item={item} active={active} onSelect={select} collapsed={collapsed} />
        ))}
      </nav>

      <div className="office-nav__footer">
        <div className="office-nav__status">
          <span className={`office-nav__status-dot ${connected ? "office-nav__status-dot--online" : ""}`} />
          <div className="office-nav__status-copy">
            <strong className="office-nav__status-title">
              {working
                ? `${working} agent${working === 1 ? "" : "s"} working`
                : (connected ? "Office ready" : "Office unavailable")}
            </strong>
            <span className="office-nav__status-detail">
              {nora?.provider && nora?.model
                ? `${nora.provider} · ${nora.model}`
                : (connected ? "Nora ready" : "Backend offline")}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="office-nav__theme"
          onClick={cycleTheme}
          aria-label={effectiveTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {effectiveTheme === "dark" ? <IconSun size={18} /> : <IconMoon size={18} />}
          <span>{effectiveTheme === "dark" ? "Light mode" : "Dark mode"}</span>
        </button>
        <div className={`office-nav__workspace ${collapsed ? "office-nav__workspace--collapsed" : ""}`}>
          <span className="office-nav__workspace-mark">C</span>
          <strong className="office-nav__workspace-name">Carlos's Workspace</strong>
        </div>
      </div>

      <BottomSheet open={moreOpen} title="More" onClose={() => setMoreOpen(false)}>
        <nav className="office-nav__more-menu" aria-label="More navigation">
          {items.filter(item => !item.primary).map(item => {
            const Icon = item.icon;
            const current = active === item.id;

            return (
              <button
                key={item.id}
                type="button"
                className={`office-nav__more-item ${current ? "office-nav__more-item--active" : ""}`}
                onClick={() => select(item.id)}
              >
                <Icon size={19} stroke={1.7} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </BottomSheet>
    </aside>
  );
}
