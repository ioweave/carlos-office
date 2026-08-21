import { useEffect } from "react";
import { IconX } from "@tabler/icons-react";

export default function BottomSheet({ open, title, onClose, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = event => { if (event.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="bottom-sheet" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="bottom-sheet__panel" onClick={event => event.stopPropagation()}>
        <div className="bottom-sheet__handle" />
        <header className="bottom-sheet__header">
          <h2 className="bottom-sheet__title">{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><IconX size={18} /></button>
        </header>
        <div className="bottom-sheet__body">{children}</div>
      </div>
    </div>
  );
}