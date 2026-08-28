# Agent Reach

Use the `agent-reach` Tool to inspect which internet backends are installed and healthy. For login-backed or multi-backend platforms, run `doctor` before choosing a command.

Agent Reach is a router and installer; most reads are performed by the upstream command it recommends. Use existing Carlos Office Tools for those commands instead of creating another wrapper layer.

## Common read paths

- General web page: prefer the `http` Tool against `https://r.jina.ai/<URL>` when plain readable content is sufficient.
- Web search: `mcporter call exa.web_search_exa query="..." numResults=5` through `run-powershell` when Doctor reports Exa available.
- GitHub: `gh search repos`, `gh search code`, and other read-only `gh` commands.
- YouTube: use `yt-dlp` for metadata/subtitles when available.
- Bilibili: use `bili` rather than assuming YouTube tooling works.
- Twitter/X, Reddit, Facebook, Instagram, XiaoHongShu and similar login-backed sources: follow the backend reported by `agent-reach doctor --json`; do not invent another login flow.

## Security and authority

Never print, log, or place cookies/tokens in model context. Do not automate browser login or extract credentials without an explicit Carlos request. Read-only research is distinct from posting, messaging, liking, account changes, purchases, or other side effects; those require an appropriate Tool and authority boundary.

Use the Agent execution workspace for temporary files. When a command fails, inspect Doctor/output and change strategy rather than repeating the same command blindly.
