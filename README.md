# Carlos Office

Carlos Office is a private, local-first multi-agent operating platform. Nora is the singleton Chief of Staff and conversational intake; Marco, Luma, Dex, Iris, Vera, and future staff are configurable AgentDefinitions (specialist blueprints). They collaborate through visible, durable Workflow executions rather than hidden subagent sessions.

## Product model

- **Conversation** is durable communication history. Every incoming channel thread maps to one conversation, stored as Markdown under `ObsidianVault/30-Conversations/<folder>/` with its attachments and workflow-produced artifacts.
- **Request** is a user message or external event that may start zero or more Workflows.
- **ProcessDefinition** is an editable DAG. Publishing creates an immutable **ProcessVersion** snapshot. A Workflow always runs against one explicit published version — never a draft, never a silent fallback.
- **Workflow** is one in-memory execution of a published process version, optionally tied to its originating conversation. (The live execution term is `Workflow`; legacy `Job` terminology is not used.)
- **Task** is one process-node execution. A Task owns its attempts, ordered tool activity, artifacts, errors, and quality assessments.
- **AgentDefinition** is a specialist blueprint. Nora is the single permanent singleton process; specialists are temporary forked child processes allocated to one task at a time.
- **Tool** is an executable capability in `Back/tools/*.mjs`, loaded by the ToolRegistry. Tool calls are validated, scope-checked, and bounded by the control plane; specialists never hold secrets.
- **Skill** is a structured strategy/playbook (`Back/skills/*.md`) that describes how tools should be used. Skills are guidance only and never grant authorization.
- **Authorization** is a scoped, auditable human authority boundary, recorded with the tool, attempt, and execution context, and bounded by expiry.

There is intentionally no user-facing Session or Subagent object. Context checkpoints and worker instances are internal details of conversations and Workflows.

## Main surfaces

Chat, Office Map, Processes, Agents, Tools, Skills, Authorizations, Operations, Schedules, and Settings.

The Office Map preserves the spatial operating metaphor: durable conversations orbit Nora, Workflows remain inside the central sphere, permanent staff surround it, and active AgentInstances appear as satellite dots connected Agent → Instance → Workflow.

## Run locally

Requires Node.js 22.12 or newer and Ollama or another configured model provider.

```bash
cd Back
npm install
cp .env.example .env
npm run dev
```

```bash
cd Front
npm install
npm run dev
```

Backend: `http://127.0.0.1:3002`  
Frontend: `http://127.0.0.1:3003`

The backend is pinned to port 3002. If 3002 is already in use, startup fails with a clear message — the server never silently falls back to another port and never kills an unrelated process occupying 3002.

## Storage and recovery

Conversations, attachments, and workflow-produced artifacts remain readable Markdown and files in the configured Obsidian vault (`ObsidianVault/30-Conversations/`). Process definitions, immutable published versions, settings, schedules, and agent configs are durable JSON under `ObsidianVault/90-System/Runtime/`. The active Workflow state, tasks, attempts, events, authorizations, and instances live in the in-memory RuntimeStore bound to those immutable published snapshots.

On restart, the in-memory runtime is rebuilt from durable process versions and agent configs; queued work resumes. A running attempt that was interrupted is recorded truthfully; idempotent work may retry, while an uncertain side effect must reconcile before retry. Workflows never silently disappear or restart from the beginning.

See [PROJECT_FUNCTIONAL_SPECIFICATION.md](PROJECT_FUNCTIONAL_SPECIFICATION.md) and [MANDATORY_CODING_STANDARD.md](MANDATORY_CODING_STANDARD.md) for the complete contract and coding rules.