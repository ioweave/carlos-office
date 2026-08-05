# Carlos Office

Local-first operating interface for Mer1dian's agent team: Nora, Marco, Luma, and Dex.

## Stack

- JavaScript only: `.mjs` backend and `.jsx` frontend
- Node.js ESM
- Axios
- React + Vite
- Ollama-first local inference
- Obsidian-compatible Markdown for **all persistent data**
- no login for local operation
- no MongoDB or other database service
- no agent framework
- no TypeScript

## Obsidian-only storage

Carlos Office has no database connection. The configured Obsidian vault stores:

```text
CarlosOfficeVault/
├── 00-Inbox/                    Worker memory proposals for Nora
├── 10-Shared/                   Curated company memory
├── 20-Agents/                   Agent-specific durable memory
├── 30-Conversations/
│   ├── Threads/                 Complete chat threads
│   └── YYYY-MM-DD.md            Daily conversation journals
├── 40-Jobs/                     Delegated job records
└── 90-System/
    └── Runtime/Agents/          Provider and model settings
```

Every stored object is a `.md` file that can be inspected, backed up, moved, or edited through Obsidian. Machine-readable state is embedded inside the Markdown notes; there are no JSON database files.

Agent runtime configuration notes are excluded from automatic semantic memory injection. Curated notes, agent notes, conversations, and job records remain searchable through the shared memory tools.

## Local architecture

```text
Browser (127.0.0.1:5173)
    -> Carlos Office API (127.0.0.1:3002)
        -> Obsidian Markdown vault
        -> Ollama (127.0.0.1:11434)
        -> optional cloud AI providers
        -> shared web/MCP tool registry
```

## Start locally

Prerequisites:

- Node.js 20 or newer
- Ollama
- Obsidian is optional but recommended for viewing and editing the vault

```bash
ollama serve
ollama pull qwen3:8b
```

Backend:

```bash
cd Back
cp .env.example .env
npm install
npm run dev
```

Frontend:

```bash
cd Front
cp .env.example .env
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

The vault defaults to `~/CarlosOfficeVault`. To use another location:

```env
OBSIDIAN_VAULT_PATH=C:\absolute\path\to\CarlosOfficeVault
MEMORY_TIME_ZONE=America/Guayaquil
```

Open that same folder as a vault in Obsidian.

## Model hot-swapping

Each agent's provider, model, base URL, temperature, tool limit, enabled state, and optional fallback are stored in a Markdown configuration note under `90-System/Runtime/Agents`.

Saving a change in the Agents screen affects the next invocation without restarting the application. Cloud fallback remains disabled by default.

## Permanent memory and MCP tools

All agents can use:

- `memory_search`
- `memory_read`
- `memory_list`
- `memory_write`
- `web_search`
- `fetch_url`
- `current_time`

Nora can also list agents, inspect installed Ollama models, and create durable worker jobs.

Run the MCP stdio server with:

```bash
cd Back
npm run mcp
```

## Local-only boundary

The API binds to `127.0.0.1` and has no authentication by design. Do not bind it to a public interface without first adding authentication and authorization.

This scaffold does not expose autonomous email, ad-platform, payment, publishing, GitHub, deployment, or destructive filesystem actions.
