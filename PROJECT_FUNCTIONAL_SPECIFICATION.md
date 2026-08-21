# Carlos Office — Functional Specification

## 1. Purpose

Carlos Office is a private, local-first AI operating environment for Carlos.

Carlos is the CEO and final authority. Nora is the one permanent Chief of Staff. Carlos primarily communicates with Nora. Nora may answer directly, use an existing Process, create an ad-hoc Workflow, or create reusable Tools, Skills, Processes, and Schedules needed to perform the work.

The product is intentionally small. It is not:

- a multi-user SaaS;
- a distributed workflow engine;
- Kubernetes for agents;
- an event-sourcing platform;
- a generic enterprise orchestration framework;
- a system that needs transactional infrastructure for ordinary local files.

The simplest correct implementation is the required implementation.

## 2. Mandatory implementation guidance

`MANDATORY_CODING_STANDARD.md` is authoritative for code style, module structure, validation, SCSS, error handling, and validation commands.

TypeScript and TSX must not be introduced unless Carlos explicitly approves them.

The Office Map is an approved operational interface. Changes to its visual design require an explicit product reason; ordinary runtime work should not redesign it.

## 3. Operating model

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

Product principles:

1. Carlos retains final human authority.
2. There is exactly one permanent Nora.
3. Specialist Agents are temporary workers created for Workflow Tasks.
4. Processes are reusable definitions; Workflows are runtime snapshots.
5. Workers execute Tasks but do not directly mutate Workflow structure.
6. Tools perform executable actions; Skills provide guidance.
7. A Tool that declares `requiresApproval` cannot run that action without Carlos's matching approval.
8. Failures and cancellations must be represented truthfully.
9. Local files are preferred over databases and infrastructure frameworks.
10. Runtime timestamps are persisted in UTC and localized only in the UI.

## 4. Actors

### 4.1 Carlos

Carlos can:

- send requests to Nora;
- inspect Conversations, Workflows, Tasks, Attempts, Agents, Events, Tools, Skills, and Artifacts;
- approve or reject Tool actions requiring authority;
- cancel, resume, restart, skip, or edit Workflow work where the UI permits;
- change Nora and Agent blueprint model configuration from the Office Map;
- change a Conversation's Nora provider/model without changing Nora's global default;
- create Schedules;
- promote an ad-hoc Workflow into a reusable Process.

### 4.2 Nora

Nora is the singleton Chief of Staff while the backend is running.

Nora may:

- classify Carlos's requests;
- answer directly;
- choose an existing Process;
- create an ad-hoc Workflow;
- select temporary specialist Agents, Tools, Skills, providers, and models for Tasks;
- create or update Tools, Skills, Processes, and Schedules when a request requires them;
- review completed Workflows;
- review a failed Task and recommend a safe retry or escalation.

Nora must not:

- create another Nora;
- approve Carlos's authorization requests herself;
- report failed work as successful;
- continue starting new side effects after Workflow cancellation;
- silently treat interrupted work as successfully resumed after restart.

### 4.3 Specialist Agent blueprints

Agent blueprints are durable configuration, not permanent running services.

The initial specialist names may include Dex, Iris, Luma, Marco, and Vera. Each blueprint can define instructions and a provider/model default.

### 4.4 Specialist Agent instances

An Agent instance is temporary. It is created for one Task in one Workflow and disposed when that execution ends.

An instance records at least:

- unique ID;
- blueprint;
- Workflow context;
- Task ID;
- current runtime status.

The current implementation does not require OS child processes, containers, remote workers, or a worker fleet.

## 5. Core domain model

### 5.1 Conversation

A Conversation is durable communication history between Carlos and Nora.

It stores:

- conversation ID;
- Conversation-specific Nora provider/model selection;
- messages;
- related Workflow IDs;
- related Artifacts.

Changing a Conversation model changes only that Conversation and its non-terminal Workflows. It does not rewrite Nora's global blueprint.

### 5.2 Process

A Process is a durable reusable DAG definition containing:

- name;
- purpose;
- declared inputs;
- start node;
- end node;
- Task definitions;
- dependency edges.

A Process file is validated before it becomes available. A Workflow receives a copied runtime snapshot of the Process graph. The v1 product does not require a separate ProcessVersion, draft/publish lifecycle, or version database.

### 5.3 Workflow

A Workflow is one runtime execution. It can come from a Process or be ad-hoc.

It contains:

- Workflow ID;
- source Process name when applicable;
- status;
- inputs and runtime config;
- copied Task graph and dependency edges;
- Task Attempt history;
- final result when available.

Required v1 statuses are those implemented by the runtime, including `running`, `blocked`, `completed`, `failed`, and `cancelled`.

Workflow state is persisted as local JSON so Operations remains inspectable across backend restarts.

### 5.4 Task

An executable Task contains the reusable execution requirements needed by a specialist Agent, including where present:

- objective;
- completion criteria;
- inputs and output name;
- explicit Agent blueprint;
- Tool names;
- Skill names;
- provider/model override;
- runtime status;
- ordered Attempt history.

Dependencies determine when pending Tasks become ready.

### 5.5 Task Attempt

Each execution try creates a separate Attempt containing:

- ID and attempt number;
- Workflow and Task IDs;
- Agent instance;
- provider/model;
- resolved input;
- selected Tools and Skills;
- UTC start/end timestamps;
- status;
- result, blocker, or error.

Previous Attempts remain inspectable.

### 5.6 Tool

A Tool is an executable `.mjs` module in `Back/tools/`.

A Tool exposes at least:

- unique name;
- description where useful;
- input contract;
- executable function;
- optional output contract;
- optional `requiresApproval` flag;
- optional provider/model metadata for Tool-specific execution.

Nora may autonomously create or update Tool modules as part of local operation. The Tool registry validates and loads the resulting module before making it available.

If a Tool declares `requiresApproval`, the exact Workflow/Task/Tool/input action must have a matching approved Authorization before execution. Approved authorizations are consumed, not deleted.

Tools receive Workflow/Task/Attempt context and an `AbortSignal`. Cooperative Tools should stop promptly when that signal is aborted.

### 5.7 Skill

A Skill is Markdown guidance in `Back/skills/`.

Skills guide Task execution but cannot execute side effects or grant authority. Full Skill content is loaded for the Task that uses it. Nora's routing context receives compact Skill summaries rather than every full Skill document.

### 5.8 Authorization

An Authorization is a durable authority record with:

- UUID;
- action;
- actor;
- exact execution context;
- status: pending, approved, rejected, or consumed;
- UTC creation/resolution/consumption timestamps.

Authorization history survives backend restart.

### 5.9 Artifact

An Artifact is a file related to a Conversation.

Artifact bytes are stored under an ID-based unique filename so two files with the same human filename cannot overwrite each other's historical content. The original filename remains metadata for display/download.

Text-like request Artifacts are supplied to Nora's intake and to Workflow inputs when a Workflow is created. Binary request Artifacts are represented by metadata unless a Tool explicitly reads them.

### 5.10 Event

Events are append-only local JSONL diagnostics, not an architectural event-sourcing system.

Every event receives a UTC ISO timestamp. Events make failures, Workflow transitions, approvals, Tool execution, scheduling, and recovery inspectable in Operations.

### 5.11 Schedule

A Schedule starts a Process either once or by cron.

Time rules:

- one-time Schedule timestamps are persisted as canonical UTC ISO values;
- cron expressions are evaluated in UTC;
- `lastRunAt` and `nextRunAt` are persisted as UTC ISO values;
- the UI converts one-time local user input to UTC before submission;
- the UI converts stored timestamps to the browser's local timezone for display.

## 6. Workflow execution

Nora's runtime loop is deliberately direct:

1. Load the current Workflow.
2. Stop when it is terminal or blocked.
3. Find ready Tasks.
4. Resolve any unspecified Agent/Tool/Skill/model selections.
5. Create one temporary specialist Agent per assigned Task.
6. Run independent ready Tasks in parallel.
7. Persist Attempt and Task transitions.
8. Dispose temporary Agents after execution.
9. Continue until the Workflow completes, blocks, fails, or is cancelled.

If no ready Tasks exist while the Workflow is otherwise active, record a stalled event rather than inventing progress.

## 7. Cancellation

Cancellation must stop future work, not merely change a label.

When Carlos cancels a Workflow:

- active Task AbortControllers are aborted;
- provider requests receive the AbortSignal;
- no new Tool call may begin after cancellation is observed;
- Tools receive the same AbortSignal for cooperative cancellation;
- running Attempts become cancelled rather than failed;
- pending/running non-terminal Tasks become cancelled;
- the Workflow becomes cancelled;
- cancellation is recorded durably.

A side effect that already completed before cancellation cannot be undone and must not be represented as if it were.

## 8. Restart recovery

Carlos Office does not require a replay engine or distributed recovery service.

At backend startup, persisted Workflows are inspected before loading into memory. If a Workflow or Attempt was running when the previous backend stopped:

- running Attempts are closed with a UTC end timestamp and interruption error;
- running Tasks become blocked;
- the Workflow becomes blocked;
- a UTC interruption record/event is saved;
- work is not automatically retried.

Carlos may then inspect the Workflow and explicitly resume or restart it. This avoids duplicating uncertain external side effects.

## 9. Chat behavior

Chat is Carlos's direct request channel to Nora.

For a direct response or creation action, the HTTP request may return the completed direct result.

For a Workflow request:

1. save Carlos's message;
2. classify the request;
3. create and persist the Workflow;
4. link it to the Conversation;
5. save Nora's acknowledgement;
6. return the Workflow to Chat promptly;
7. continue Workflow execution in the backend;
8. let the frontend poll the Workflow card;
9. append Nora's final handover or truthful failure/blocker message to the Conversation.

The frontend does not need SSE for v1. Bounded polling is sufficient.

## 10. Office Map

The Office Map is the primary operational and Agent-configuration interface.

It shows Nora, specialist blueprints, active Agent instances, Workflows, Conversations, and runtime activity using the approved spatial metaphor.

Agent/Nora model configuration belongs here. A separate Agents or Settings page is not required.

## 11. Processes and Schedules

The Processes surface provides:

- Process index;
- Process graph inspection;
- Task details;
- Ask-Nora creation/revision actions;
- Schedule creation, enable/disable, inspection, and manual trigger.

Schedules are part of Processes rather than a separate navigation surface.

## 12. Operations

Operations is the detailed runtime surface for:

- Workflow list and status;
- Workflow graph/task state;
- Attempts;
- recent Events;
- blockers and errors;
- pending Authorizations;
- resume/restart/cancel/skip/edit controls already supported by the backend;
- promotion of an ad-hoc Workflow to a Process.

Operations reflects durable state; it must not invent missing runtime data.

## 13. Authorizations

Authorizations is Carlos's authority inbox and history.

It shows pending, approved, consumed, and rejected records. Stored UTC timestamps are converted to local browser time for display.

## 14. Capabilities

Capabilities combines the Tool and Skill catalogs in one surface.

It supports:

- browsing/searching installed Tools;
- inspecting Tool contracts and approval requirement;
- browsing/searching Skills;
- reading full Skill content;
- asking Nora to create or update a Tool or Skill.

Separate Tools and Skills navigation entries are not required.

## 15. Appearance and configuration

Theme switching belongs in the sidebar. Backend connectivity is visible globally. Agent/Nora provider-model configuration belongs in the Office Map. Conversation-specific model selection belongs in Chat.

A separate Settings surface is not required for v1.

## 16. Persistence and privacy

Private runtime/user data must not be committed to Git.

Ignored local data includes:

- Conversations and Artifacts;
- Events;
- Processes;
- Workflows;
- Schedules;
- Authorization runtime state;
- credentials, OAuth/session material, caches, and local runtime files.

Source-controlled configuration includes application code, Agent blueprints, Tools, Skills, specifications, and example environment files.

## 17. Time contract

All persisted timestamps use UTC ISO-8601 strings produced or normalized by JavaScript `Date#toISOString()`.

The backend must never persist locale-formatted dates or depend on the host's local timezone for cron matching.

The frontend may use `Date` and `toLocaleString`/`toLocaleTimeString` to present timestamps in the browser's local timezone. Local date/time form input is converted to UTC before persistence.

## 18. Validation and CI

Routine validation consists of:

Backend:

```bash
npm run lint
npm run check
```

Frontend:

```bash
npm run lint
npm run build
```

CI performs those checks on pushes and pull requests.

Automated tests are not mandatory and are added or run only when Carlos explicitly requests them, consistent with `MANDATORY_CODING_STANDARD.md`.

## 19. Non-requirements for v1

Do not introduce the following without a demonstrated product need:

- separate immutable ProcessVersion infrastructure;
- draft/publish/archive machinery merely for architecture completeness;
- a generic command bus or revision-conflict framework;
- a separate autonomous recovery Agent;
- SSE/WebSocket infrastructure when polling is sufficient;
- event sourcing;
- distributed locks or queues;
- databases solely to replace the current local files;
- transaction/journaling frameworks for ordinary local configuration;
- permanent specialist Agent services;
- generic multi-user authentication/RBAC infrastructure for this local single-owner product.
