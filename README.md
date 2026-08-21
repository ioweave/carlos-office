# Carlos Office

Carlos Office is a private, local-first AI operating environment for one owner: Carlos.

Carlos is the CEO and final authority. Nora is the single permanent Chief of Staff. Carlos talks primarily to Nora; Nora decides whether to answer directly, use an existing Process, create an ad-hoc Workflow, or create the reusable capabilities needed to perform the request.

The operating model is:

```text
Carlos
  ↓
Nora
  ↓
Process / Workflow
  ↓
Temporary Specialist Agents
  ↓
Tools + Skills
  ↓
Result / Artifact
```

Carlos Office is intentionally not an enterprise orchestration platform, distributed workflow engine, event-sourcing system, or generic multi-user SaaS.

## Core concepts

- **Conversation** — durable communication between Carlos and Nora. A Conversation stores its own Nora provider/model selection without changing Nora's global default.
- **Nora** — the one permanent Chief of Staff and workflow manager.
- **Process** — a durable reusable DAG definition.
- **Workflow** — a durable runtime snapshot created from a Process, or an ad-hoc DAG created for one request.
- **Task** — one executable Workflow node with durable Attempt history.
- **Agent Blueprint** — configuration for a specialist such as Dex, Iris, Luma, Marco, or Vera.
- **Agent Instance** — a temporary worker created for one Task and disposed when that work ends.
- **Tool** — executable `.mjs` capability. Nora can create or update Tools locally when a request requires one.
- **Skill** — reusable Markdown guidance supplied to a Task.
- **Authorization** — Carlos's durable decision for a Tool action that declares it requires approval.
- **Schedule** — a UTC timer that starts a Process.
- **Event** — append-only local diagnostic history for important runtime transitions.
- **Artifact** — a file attached to or produced for a Conversation.

## Product surfaces

Carlos Office has six primary surfaces:

1. **Chat** — Carlos's direct channel to Nora.
2. **Office Map** — the operational view and Agent/Nora configuration surface.
3. **Processes** — reusable Process definitions and Schedules.
4. **Operations** — live and historical Workflow inspection and controls.
5. **Authorizations** — Carlos's durable approval history and pending authority requests.
6. **Capabilities** — the installed Tool and Skill catalogs.

Appearance controls remain in the sidebar. Agent and Nora configuration belongs in the Office Map; there is no separate Settings or Agents page.

## Runtime behavior

Chat intake is short-lived. When Nora decides a request needs a Workflow, the backend creates and links the Workflow, returns it to Chat immediately, and continues execution in the backend. Chat displays the live Workflow card and reloads Nora's durable final handover when execution reaches a terminal state.

Workflow cancellation is cooperative and authoritative at execution boundaries. Carlos cancelling a Workflow aborts active provider requests, prevents new Tool calls from starting, passes the same `AbortSignal` to Tools, and records cancelled Attempts truthfully. An external side effect that already completed cannot be undone.

If the backend stops during active work, startup does not pretend that work resumed. Previously running Attempts are marked interrupted, the Workflow becomes blocked, and Carlos can explicitly resume or restart it after inspection.

## Time model

**All persisted timestamps are UTC ISO-8601 values.**

- Events, messages, artifacts, attempts, authorizations, Workflow interruptions, and Schedule run timestamps are stored in UTC.
- One-time Schedule values are normalized to UTC before persistence.
- Cron expressions are interpreted in UTC.
- The frontend converts timestamps to the browser's local timezone only for display and local date/time input convenience.

## Local storage

Carlos Office uses direct files rather than a database:

```text
Back/ObsidianVault/30-Conversations/          private conversations + artifacts
Back/ObsidianVault/90-System/Processes/       private Process definitions
Back/ObsidianVault/90-System/Workflows/       private Workflow runtime snapshots
Back/ObsidianVault/90-System/Schedules/       private Schedules
Back/ObsidianVault/90-System/Events/          private JSONL event history
Back/ObsidianVault/90-System/Runtime/          private runtime state
Back/ObsidianVault/90-System/Agents/           tracked Agent blueprints
Back/tools/                                    executable Tools
Back/skills/                                   Markdown Skills
```

Private runtime data is ignored by Git. Agent blueprints, Tools, Skills, application code, and product specifications remain source-controlled.

## Run locally

Requires Node.js 22.12 or newer and Ollama.

Backend:

```bash
cd Back
npm install
cp .env.example .env
npm run dev
```

Frontend:

```bash
cd Front
npm install
npm run dev
```

Defaults:

- Backend: `http://127.0.0.1:3002`
- Frontend: `http://127.0.0.1:3003`
- Browser API access is restricted to `FRONTEND_ORIGIN` (default `http://127.0.0.1:3003`).

## Validation

Backend:

```bash
cd Back
npm run lint
npm run check
```

Frontend:

```bash
cd Front
npm run lint
npm run build
```

The repository CI runs those checks only; automated tests are not required unless Carlos explicitly asks for them.

See `PROJECT_FUNCTIONAL_SPECIFICATION.md` for the functional contract and `MANDATORY_CODING_STANDARD.md` for implementation rules.
