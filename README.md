# Carlos Office

Carlos Office is a private, local-first multi-agent operating platform. Nora is the manager and conversational intake; Marco, Luma, Dex, Iris, Vera, and future staff are configurable AgentDefinitions. They collaborate through visible, durable process jobs rather than hidden subagent sessions.

## Product model

- **Conversation** is durable communication history. Every incoming channel thread maps to one conversation.
- **Request** is a user message or external event that may start zero or more jobs.
- **ProcessDefinition** is an editable n8n-style DAG. Publishing creates an immutable ProcessVersion.
- **Job** is one execution of a published process version, optionally tied to its originating conversation message.
- **Task** is one process-node execution. A Task owns its attempts, ordered tool activity, artifacts, errors, and quality assessments.
- **AgentDefinition** is permanent or temporary staff configuration. **AgentInstance** is one worker allocated to one job; it executes one task at a time.
- **ToolProvider** exposes programmatic Tools. MCP servers are providers, not generic agent-facing calls.
- **Skill** is a structured strategy/playbook that describes how granular tools should be used.
- **Authorization** is a scoped, auditable human authority boundary. It is distinct from process Human Approval nodes.

There is intentionally no user-facing Session or Subagent object. Context checkpoints and worker instances are internal details of conversations and jobs.

## Main surfaces

Chat, Office Map, Processes, Agents, Tools, Skills, Authorizations, Operations, and Settings.

The Office Map preserves the spatial operating metaphor: durable conversations orbit Nora, jobs remain inside the central 3D sphere, permanent staff surround it, and active AgentInstances appear as satellite dots connected Agent → Instance → Job.

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

The backend dev script kills any previous process on port 3002 before nodemon starts.

## Storage and recovery

Conversations and governed knowledge remain readable Markdown in the configured Obsidian vault. Process definitions, immutable versions, jobs, tasks, attempts, events, assessments, authorizations, queues, and operational aggregates use embedded SQLite.

On restart, queued work resumes. A running attempt becomes `interrupted`; idempotent work may retry, while an uncertain side effect must reconcile before retry. Jobs never silently disappear or restart from the beginning.

See [PLATFORM_ARCHITECTURE.md](Back/artifacts/PLATFORM_ARCHITECTURE.md) for the complete contract.
