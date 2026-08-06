# Carlos Office

Carlos Office is Carlos's private, local-first company operating system.

## Agent team

- **Nora** — Chief of Staff and primary interface
- **Marco** — Commercial Strategy
- **Luma** — Creative Direction
- **Dex** — Development and Automation
- **Iris** — Research and Intelligence
- **Vera** — Quality Control and Acceptance

## Core architecture

- JavaScript only: Node.js ESM backend and React/Vite frontend
- Ollama Cloud primary inference with local Ollama fallback
- Obsidian-compatible Markdown for conversations, jobs, configurations, and permanent memory
- no MongoDB or external application database
- local API bound to loopback by default

## Model routing

```text
Primary:  minimax-m3:cloud
Fallback: qwen3:8b
Policy:   fallback only for cloud-connectivity failures
```

Authentication, quota, invalid-model, and configuration failures remain visible instead of silently using the fallback.

## Conversations

Every conversation is stored as its own Markdown file:

```text
CarlosOfficeVault/
└── 30-Conversations/
    ├── Threads/<conversationId>.md
    └── Attachments/<conversationId>/...
```

The interface supports creating, reopening, renaming, updating, searching, and deleting conversations. Text/code attachments are supplied as model context; image attachments are supplied to compatible vision models. Browser voice input and speech synthesis remain available.

## Delegated jobs and Vera QC

Nora may delegate to Marco, Luma, Dex, or Iris. Jobs include a concrete expected result and objective acceptance criteria.

```text
Nora assigns work
    -> worker produces a deliverable
    -> Vera checks explicit criteria
        -> pass: completed
        -> revise: another bounded iteration
        -> limit reached: awaiting approval
```

Operational defaults:

- two concurrent jobs;
- two iterations for ordinary new jobs;
- per-agent model serialization rather than one global model queue;
- shorter tool-free Vera reviews;
- cancellable worker and QC requests;
- priority-aware queueing.

The Jobs page can stop one job, stop all active jobs, continue a stopped or unaccepted job, delete one job, clear terminal jobs, or clear all job records. Stopping an active job aborts its in-flight model request and records the cancelled state in Markdown.

## Playwright browser tools

Nora, Dex, Iris, and Vera can inspect permitted pages with Playwright. Nora, Dex, and Vera can also perform bounded interactions.

Available operations:

- inspect rendered headings, controls, links, inputs, text, and dialogs;
- detect document-level horizontal overflow and apparently unlabeled controls;
- capture console errors, page errors, and failed requests;
- take screenshots into the Obsidian runtime folder;
- perform bounded click, fill, key, select, check, uncheck, and wait steps.

Only `localhost`, `127.0.0.1`, and `::1` are accepted by default. Add explicit external origins only when required:

```env
PLAYWRIGHT_ALLOWED_ORIGINS=https://example.test
```

## Installation

Prerequisites:

- Node.js 20 or newer
- Ollama
- Obsidian, optional but recommended

Prepare Ollama:

```powershell
ollama signin
ollama pull minimax-m3:cloud
ollama pull qwen3:8b
```

Backend:

```powershell
cd Back
Copy-Item .env.example .env
npm install
npm run playwright:install
npm run dev
```

Frontend:

```powershell
cd Front
Copy-Item .env.example .env
npm install
npm run dev
```

Open the Vite address shown in the frontend terminal, normally `http://127.0.0.1:5173`.

## Useful backend settings

```env
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=minimax-m3:cloud
OLLAMA_FALLBACK_MODEL=qwen3:8b

JOB_CONCURRENCY=2
JOB_DEFAULT_ITERATIONS=2
JOB_MAX_TOOL_ROUNDS=2
JOB_WORKER_TIMEOUT_MS=90000
JOB_QC_TIMEOUT_MS=45000
AI_REQUEST_TIMEOUT_MS=120000

PROJECT_ROOT=
OBSIDIAN_VAULT_PATH=
PLAYWRIGHT_ALLOWED_ORIGINS=
```

The vault defaults to `~/CarlosOfficeVault`. `PROJECT_ROOT` defaults to the repository parent of `Back` when the backend is started from the `Back` directory.

## MCP server

```powershell
cd Back
npm run mcp
```

The MCP surface includes memory, web research, repository inspection, Playwright inspection, agent listing, job creation, job inspection, cancellation, continuation, and clearing.
