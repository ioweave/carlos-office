# Carlos Office

Carlos Office is a private, local-first AI operating environment for one owner: Carlos.

Carlos is the CEO and final authority. Nora is the single permanent Chief of Staff. Carlos talks primarily to Nora; Nora decides whether to answer directly, use an existing Process, create an ad-hoc Workflow, or create the reusable capabilities needed to perform the request.

```text
Carlos
  ↓
Nora process
  ↓
Process / Workflow graph
  ↓
Temporary Agent processes
  ↓
Tools + Skills
  ↓
Result / Artifact
```

Carlos Office is intentionally not an enterprise orchestration platform, distributed workflow engine, event-sourcing system, or generic multi-user SaaS.

## Runtime architecture

Carlos Office has three executable roles:

```text
platform.mjs
src/runtime/nora.mjs
src/runtime/agent.mjs
```

### Platform

`Back/platform.mjs` is the persistent server-like Node process. It owns:

- HTTP/API;
- local persistence;
- Process and Workflow graph execution;
- Schedules;
- Tool and Skill registries;
- Tool execution and Authorizations;
- Conversation and Artifact storage;
- Knowledge storage and injection;
- spawning, observing, cancelling, and terminating child processes.

The Platform does not make LLM decisions.

### Nora

Nora is one persistent Node child process. She owns reasoning and decisions. The Platform sends decision requests to Nora over Node IPC and receives structured decisions back.

Nora's implementation-level operating definition and default model live in `Back/ObsidianVault/System/Nora.md`. User-managed durable facts and standing instructions live separately in Knowledge and are injected into every Nora decision.

### Agent

An Agent is one temporary child process executing one Task. It has no persistent identity, persona, definition file, default model, default Tools, or default Skills.

For each executable Task, the Platform forks `src/runtime/agent.mjs`. The process receives the resolved Task objective, input, completion criteria, provider/model, Tools, Skills, and current Knowledge; it runs the model/Tool loop, returns one result, and exits.

The Agent process itself is the Agent Instance. Tools execute in the Platform process, and Agents request Tool execution through IPC so Carlos's Authorization rules and side effects remain centrally controlled.

## Process graph

A Process is data, not executable code. It defines:

- one start node;
- one end node;
- Task nodes;
- directed edges;
- reusable Task requirements.

The graph guides execution and supports branching/fan-out and joins. A Workflow is a durable runtime copy of that graph. The Platform marks Tasks ready from graph dependencies and starts independent ready Tasks in parallel.

## Core concepts

- **Conversation** — durable communication between Carlos and Nora.
- **Nora** — the one permanent Chief of Staff Node process.
- **Knowledge** — private durable facts and standing instructions automatically supplied to Nora and temporary Agents.
- **Process** — a reusable directed graph definition.
- **Workflow** — one durable runtime copy of a Process graph, or an ad-hoc graph.
- **Task** — one executable graph node.
- **Attempt** — one durable execution record for a Task.
- **Agent Instance** — one temporary Node process executing one Task.
- **Tool** — executable `.mjs` capability. Nora may create or update Tools locally.
- **Skill** — reusable Markdown operating guidance.
- **Authorization** — Carlos's durable approval decision for a Tool action that requires it.
- **Schedule** — a UTC timer that starts a Process.
- **Event** — append-only local diagnostic history.
- **Artifact** — a file attached to or produced for a Conversation.

## Product surfaces

Carlos Office has seven product surfaces:

1. **Chat** — Carlos's direct channel to Nora.
2. **Office Map** — operational topology and Nora configuration.
3. **Processes** — reusable Process graphs and Schedules.
4. **Operations** — live and historical Workflow inspection and controls.
5. **Authorizations** — Carlos's approval inbox and durable authority history.
6. **Capabilities** — installed Tools and Skills.
7. **Store** — Credentials, non-secret Workspace Variables, and persistent Knowledge.

There is no separate Settings, Tools, Skills, Agents, or Knowledge page. Knowledge is managed within Store.

## Knowledge

Knowledge is the persistent user-context layer. It has two deliberately distinct documents:

- `Facts.md` — durable facts, preferences, project context, names, conventions, and other information Nora should be able to consider across conversations;
- `Instructions.md` — standing instructions from Carlos that should influence Nora's behavior unless a current explicit request supersedes them.

Both documents are private local data. They are loaded at Platform startup and injected automatically into every Nora decision and every temporary Agent Task. Knowledge is not a credential store and must not contain passwords, tokens, or private keys.

Knowledge is managed manually through **Store → Knowledge**. Carlos Office does not automatically extract facts from conversations into Knowledge.

## Cancellation and restart

Cancelling a Workflow kills its active Agent child processes, aborts Platform-side Tool signals, prevents new work from being scheduled, and persists the Workflow/Attempt state truthfully. A side effect that already completed cannot be undone.

If the Platform stops during active work, startup does not pretend the work resumed. Persisted running Attempts are marked interrupted and the Workflow becomes blocked for explicit inspection/resume.

## Time model

**All persisted timestamps are UTC ISO-8601 values.**

- Events, messages, artifacts, Attempts, Authorizations, interruptions, and Schedule timestamps are stored in UTC.
- One-time Schedule values are normalized to UTC before persistence.
- Cron expressions are interpreted in UTC.
- The frontend converts timestamps to the browser's local timezone only for display/input convenience.

## Local storage

The Obsidian vault no longer uses numeric folder prefixes. They were organizational only and were never required by the runtime.

```text
Back/ObsidianVault/Conversations/              private Conversations + Artifacts
Back/ObsidianVault/Knowledge/Facts.md           private durable facts
Back/ObsidianVault/Knowledge/Instructions.md    private standing instructions
Back/ObsidianVault/System/Nora.md               Nora's persistent definition
Back/ObsidianVault/System/Processes/            private Process definitions
Back/ObsidianVault/System/Workflows/            private Workflow runtime snapshots
Back/ObsidianVault/System/Schedules/            private Schedules
Back/ObsidianVault/System/Events/               private event history
Back/ObsidianVault/System/Runtime/              private runtime state
Back/tools/                                     executable Tools
Back/skills/                                    Markdown Skills
```

Private runtime data is ignored by Git. Nora's definition, Tools, Skills, application code, and product specifications remain source-controlled. On startup, Carlos Office migrates existing `30-Conversations` and `90-System` contents into the non-prefixed directories and removes obsolete legacy vault folders.

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

- Platform API: `http://127.0.0.1:3002`
- Frontend: `http://127.0.0.1:3003`
- Browser API access is restricted to `FRONTEND_ORIGIN`.

## Validation

```bash
cd Back
npm run lint
npm run check

cd ../Front
npm run lint
npm run build
```

CI runs those checks on pushes and pull requests. Tests are added when explicitly required.

See `PROJECT_FUNCTIONAL_SPECIFICATION.md` for the functional contract and `MANDATORY_CODING_STANDARD.md` for implementation rules.
