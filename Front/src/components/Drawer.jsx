import { useEffect } from "react";
import { IconX } from "@tabler/icons-react";

export default function Drawer({ open, title, onClose, children, footer }) {
  useEffect(() => {
    if (!open) return;
    const onKey = event => { if (event.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="drawer" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="drawer__panel" onClick={event => event.stopPropagation()}>
        <header className="drawer__header">
          <h2 className="drawer__title">{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close drawer"><IconX size={18} /></button>
        </header>
        <div className="drawer__body">{children}</div>
        {footer && <footer className="drawer__footer">{footer}</footer>}
      </div>
    </div>
  );
}