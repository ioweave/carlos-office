# Carlos Office

Carlos Office is Carlos's private, local-first company operating system.

## Agent team

- **Nora** — Chief of Staff, orchestrator, memory/knowledge governor, final plan approver
- **Marco** — Commercial Strategy
- **Luma** — Creative Direction
- **Dex** — Development and Automation
- **Iris** — Research, Intelligence, and knowledge ingestion
- **Vera** — independent Quality Control and Acceptance

## Operating model

```text
Carlos
  ↓
Nora plans / reconciles source of truth
  ↓
worker executes (Marco / Luma / Dex / Iris)
  ↓
Vera independently verifies
  ↓
Nora approves or returns work for revision
  ↓
Carlos
```

Detailed job/workflow traffic is runtime telemetry. Durable storage retains compact receipts and deliberately promoted knowledge rather than every intermediate model exchange.

## Core architecture

- Node.js ESM backend + React/Vite frontend
- Node.js **22.12+**
- Ollama Cloud primary inference with local Ollama fallback
- local API bound to loopback by default
- Obsidian-compatible Markdown for durable knowledge, saved chats, compact job receipts, agent/runtime configuration, and selected workspace records
- temporary chats/session sources/live job traces stay volatile unless explicitly promoted
- no MongoDB or external application database
- generic governed MCP gateway for connected services
- Playwright for deterministic local UI verification
- Browser MCP for authenticated browser context when configured

## Model routing

```text
Primary:  minimax-m3:cloud
Fallback: qwen3:8b
Policy:   fallback for configured cloud-connectivity failures
```

Provider/auth/quota/configuration failures should remain visible rather than silently masquerading as success.

## Conversations

Every new conversation starts **temporary**.

- it remains available while the active application/backend session retains it;
- navigating between Chat, Jobs, Office Map, etc. does not itself save it;
- it is not listed as a saved chat until Carlos explicitly chooses **Save**;
- unsaved conversations/session attachments expire with their volatile lifecycle;
- saving promotes the transcript and retained attachments into durable conversation storage.

The chat supports Markdown rendering, attachments, browser voice input, speech synthesis, response cancellation, copy-to-clipboard, and generated-artifact preview.

Generated artifacts may open beside the chat in a resizable preview workspace. Supported preview classes include text/code/Markdown/HTML, images, PDFs, audio/voice, and video. Binary media is streamed with byte-range support instead of being embedded into JSON.

## Memory and knowledge

Carlos Office separates:

- working memory;
- session sources;
- compact remembered facts;
- project sources/knowledge;
- universal sources/knowledge;
- agent procedural memory;
- saved conversations;
- runtime telemetry.

Nora may retain a **stable, future-useful** fact without saving the surrounding conversation. Present-conversation state such as “Carlos will review this plan” is not durable memory.

Iris manages ingestion/hygiene; Nora governs promotion/retirement; universal knowledge is deliberately curated rather than created accidentally.

See `Back/artifacts/RETENTION_ARCHITECTURE.md`.

## Project source of truth

Durable project-level architecture/planning references live under:

```text
Back/artifacts/
```

`Back/artifacts/README.md` is the index. Before creating a new plan/audit/roadmap for Carlos Office, source-capable agents are expected to reconcile relevant existing artifacts with current source/configuration. Live code and executable validators remain authoritative for current behavior.

The canonical Dex roadmap is:

```text
Back/artifacts/DEX_CLAUDE_CODE_PLAN.md
```

## Agent capability governance

Agent tools are governed by explicit role policy. `Back/scripts/validate-agent-capabilities.mjs` now checks **exhaustive approved tool sets** for every agent, so accidental capability broadening fails validation until the role contract is intentionally updated.

MCP tool possession is separate from MCP action authorization: an agent may have `mcp_call`, while the gateway still classifies an individual operation as read/write/dangerous and applies external-action gates.

See `Back/artifacts/AGENT_CAPABILITY_AUDIT.md`.

## Delegated jobs and workflows

Jobs use explicit stages rather than a generic approval state:

```text
queued
  → running
  → qc_review (Vera)
  → nora_review
  → completed
```

If the bounded revision budget is exhausted, the job becomes `needs_attention` with explicit `waitingOn`, reason, and next-action information.

Nora-originated multi-job requests are grouped into runtime workflows. Chat, Jobs, and Office Map consume the same live workflow/event state. The Office Map visualizes actual runtime transitions with packets between Nora, jobs, workers, Vera, and back to Nora.

## Playwright browser tools

Nora, Dex, Iris and Vera can inspect permitted pages with Playwright; Nora, Dex and Vera may also perform bounded local interactions.

Current diagnostics include:

- structured rendered-page snapshot;
- headings/controls/links/inputs/dialogs;
- document-level horizontal-overflow detection;
- apparently unlabeled-control checks;
- console **errors** and uncaught page errors;
- failed requests;
- screenshots;
- bounded click/fill/press/select/check/uncheck/wait actions where allowed.

This is not a full browser DevTools console/network capture.

## Connected integrations

The MCP gateway supports configured stdio/Streamable HTTP integrations with per-agent access policy and dangerous-action gates. The supplied setup/reference covers Google Workspace, Browser MCP, monitors, optional GitHub MCP, and adding additional MCP services.

See `Back/artifacts/INTEGRATIONS_SETUP.md`.

## Installation

Prerequisites:

- Node.js 22.12+
- Ollama
- Obsidian (recommended for direct inspection of durable knowledge/storage)

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
npm run validate:capabilities
npm run validate:retention
npm run validate:workflows
npm run dev
```

Frontend:

```powershell
cd Front
Copy-Item .env.example .env
npm install
npm run dev
```

Open the Vite address shown in the frontend terminal.

## Useful backend settings

Use `Back/.env.example` as the authoritative list. Common settings include:

```env
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=minimax-m3:cloud
OLLAMA_FALLBACK_MODEL=qwen3:8b

JOB_CONCURRENCY=2
JOB_DEFAULT_ITERATIONS=2
JOB_MAX_TOOL_ROUNDS=4
JOB_WORKER_TIMEOUT_MS=900000
JOB_QC_TIMEOUT_MS=75000
AI_REQUEST_TIMEOUT_MS=120000

PROJECT_ROOT=
OBSIDIAN_VAULT_PATH=
PLAYWRIGHT_ALLOWED_ORIGINS=

MCP_ALLOW_DANGEROUS_ACTIONS=false
BROWSER_MCP_ALLOW_INTERACTION=false

DEX_ALLOW_PROJECT_DELETE=false
DEX_ALLOW_DEPENDENCY_INSTALL=false
DEX_ALLOW_ARBITRARY_NPM_SCRIPTS=false
DEX_ALLOW_DEPLOY_COMMANDS=false
```

## MCP server

```powershell
cd Back
npm run mcp
```

The MCP/runtime surfaces follow the same agent authority, retention, source-of-truth, and external-action governance used by the application.
