import { IconAlertTriangle, IconCloudOff, IconInbox, IconLoader } from "@tabler/icons-react";

const variantConfig = {
  loading: { Icon: IconLoader, spin: true, title: "Loading…" },
  empty: { Icon: IconInbox, title: "Nothing here yet" },
  offline: { Icon: IconCloudOff, title: "Office offline" },
  error: { Icon: IconAlertTriangle, title: "Something went wrong" },
};

export default function StateView({ variant = "empty", title, message, actions, icon: CustomIcon }) {
  const config = variantConfig[variant] || variantConfig.empty;
  const Icon = CustomIcon || config.Icon;

  return (
    <div className={`state-view state-view--${variant}`}>
      <span className="state-view__icon">
        <Icon size={30} stroke={1.5} className={config.spin ? "state-view__icon-spin" : ""} />
      </span>
      <h3 className={`state-view__title${variant === "error" ? " state-view__title--error" : ""}`}>{title || config.title}</h3>
      {message && <p className="state-view__message">{message}</p>}
      {actions && <div className="state-view__actions">{actions}</div>}
    </div>
  );
}