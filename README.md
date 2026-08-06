# Carlos Office

Local-first operating interface for Mer1dian's agent team: Nora, Marco, Luma, Dex, and Vera.

## Stack

- JavaScript only: `.mjs` backend and `.jsx` frontend
- Node.js ESM
- React + Vite
- Ollama for local and Ollama Cloud inference
- Obsidian-compatible Markdown for all persistent state
- no login and no database service

## Agent roles

- **Nora** — Chief of Staff and primary interface
- **Marco** — Commercial Strategy
- **Luma** — Creative Direction
- **Dex** — Development and Automation
- **Vera** — independent Quality Control and Acceptance

## Model routing

```text
Primary:  minimax-m3:cloud
Fallback: qwen3:8b
Policy:   fallback only for internet/cloud-connectivity failures
```

Authentication, quota, invalid-model, and configuration errors remain visible instead of being hidden by fallback behavior.

Prepare Ollama:

```powershell
ollama signin
ollama pull minimax-m3:cloud
ollama pull qwen3:8b
```

## Conversation workspace

The primary interface uses a three-column workspace:

- searchable conversation history
- focused conversation thread and composer
- agent, model, voice, and Markdown-file inspector

Every saved conversation has one authoritative Markdown file:

```text
30-Conversations/Threads/<conversationId>.md
```

The interface can:

- create and reopen conversations
- rename a conversation while preserving its identifier and Markdown file
- delete a conversation and its attachment directory
- append new messages to the same Markdown thread
- attach images, text, code, JSON, CSV, and other local files
- use browser speech recognition and speech synthesis

Attachments are stored outside the Markdown payload so binary data does not make the vault unreadable:

```text
30-Conversations/Attachments/<conversationId>/<attachment-file>
```

The thread Markdown retains attachment metadata and relative links. Text-compatible attachments are included as model context. Image attachments are supplied to vision-capable Ollama models. The local `qwen3:8b` connectivity fallback remains text-only, so image content is omitted during an offline fallback and that limitation is stated in context.

Default limits:

```env
MAX_CHAT_BODY_BYTES=30000000
MAX_ATTACHMENT_BYTES=8388608
MAX_ATTACHMENTS_TOTAL_BYTES=20971520
MAX_TEXT_ATTACHMENT_CHARS=200000
```

## Office Map

The **Office Map** is an interactive canvas-based, three-dimensional-style view of the operating system:

- each agent is a labeled primary node
- each conversation is a floating node beside its assigned agent
- each job is connected to Nora, its worker, and Vera
- active job edges display movement between agents
- hover reveals a title and status
- selecting a conversation opens its transcript details
- selecting a job opens its expected result, criteria, QC state, iterations, and inter-agent message timeline
- selecting an agent shows model configuration and current work

The map is a projection of existing Markdown-backed records, not a second data store. It refreshes from `/api/office-map` and includes an accessible list representation beside the canvas.

## Vera QC loop

Nora's delegated jobs require:

- a worker: Marco, Luma, or Dex
- concrete instructions
- a defined expected result
- objective acceptance criteria
- a bounded iteration limit from 1 to 8

```text
Nora creates job
    -> worker produces result
    -> Vera evaluates explicit acceptance criteria
        -> pass: job becomes completed
        -> revise: Vera feedback is sent into the next worker iteration
        -> limit reached: job becomes awaiting_approval
```

Jobs execute through a single local queue to avoid competing model runs. Pending jobs resume after a backend restart. Each worker delivery, Vera verdict, revision request, score, model, and iteration is stored in the same Markdown job note under `40-Jobs`.

## Obsidian-only storage

```text
CarlosOfficeVault/
├── 00-Inbox/
├── 10-Shared/
├── 20-Agents/
│   ├── Nora/
│   ├── Marco/
│   ├── Luma/
│   ├── Dex/
│   └── Vera/
├── 30-Conversations/
│   ├── Threads/                 One Markdown file per conversation
│   └── Attachments/             Binary/text attachments by conversation
├── 40-Jobs/                     Jobs, iterations and agent messages
└── 90-System/
    └── Runtime/Agents/          Provider/model settings
```

## Read-only project inspection

Nora, Dex, and Vera can inspect this repository with narrow read-only tools:

- `project_list_files`
- `project_read_file`
- `project_search_files`

The tools exclude `.git`, dependency/build folders, coverage output, and `.env` files. Set `PROJECT_ROOT` only when the repository is not the parent of the `Back` directory.

## Voice input and output

The chat interface supports:

- microphone dictation through the browser's Speech Recognition API
- manual playback of each assistant response
- optional automatic reading of new responses
- English and Spanish language selection

No microphone audio is sent to the Carlos Office backend.

## Start locally

Prerequisites:

- Node.js 20 or newer
- Ollama
- Obsidian, optional but recommended

Backend:

```powershell
cd Back
Copy-Item .env.example .env
npm install
npm run dev
```

Frontend:

```powershell
cd Front
Copy-Item .env.example .env
npm install
npm run dev
```

Open the URL printed by Vite. Any loopback frontend port is accepted while the backend remains bound to loopback.

The vault defaults to `~/CarlosOfficeVault`. To use another location:

```env
OBSIDIAN_VAULT_PATH=C:\absolute\path\to\CarlosOfficeVault
MEMORY_TIME_ZONE=America/Guayaquil
```

## MCP server

```powershell
cd Back
npm run mcp
```

Shared tools include permanent memory, web research, current time, Ollama model inspection, agent listing, bounded QC job creation, job inspection, job continuation, and read-only project inspection.

## Design review

Use [`NORA_UI_AUDIT_PROMPT.md`](./NORA_UI_AUDIT_PROMPT.md) to have Nora inspect the implementation, research current Impeccable and Taste guidance, and create a Vera-gated implementation plan for Dex without modifying code during the audit.

## Validation

- [`NORA_VALIDATION.md`](./NORA_VALIDATION.md) — Nora's behavioral and functional acceptance checks
- [`VERA_QC_VALIDATION.md`](./VERA_QC_VALIDATION.md) — Vera's pass, revision, bounded-failure, restart, and continuation checks
