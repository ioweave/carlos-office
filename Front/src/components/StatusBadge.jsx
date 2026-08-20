export default function StatusBadge({ tone = "neutral", className = "", children }) {
  const classes = ["status-pill", `status-pill--${tone}`, className].filter(Boolean).join(" ");
  return <span className={classes}>{children}</span>;
}