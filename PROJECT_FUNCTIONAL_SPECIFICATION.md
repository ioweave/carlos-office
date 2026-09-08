# Carlos Office — Project Functional Specification

> Current implementation baseline: **v1.1 branch**, reflecting the functionality present after the v1 stabilization pass.

## 1. Purpose

Carlos Office is a private, local-first AI operating environment for one human owner: Carlos.

Carlos is the CEO and final authority. Nora is the single persistent Chief of Staff. Carlos communicates primarily with Nora. Nora interprets intent, answers directly when appropriate, selects or creates Processes and Workflows, and coordinates temporary Agent processes that execute Tasks.

The system optimizes for clarity, local ownership, direct control, and the smallest correct implementation.

Carlos Office is intentionally **not**:

- an enterprise orchestration platform;
- a distributed workflow engine;
- an event-sourcing system;
- Kubernetes for Agents;
- a generic multi-user SaaS;
- a persistent society of named specialist Agents.

## 2. Core operating model

```text
Carlos
  ↓
Nora — permanent Chief of Staff
  ↓
Conversation / Process / Workflow
  ↓
Task
  ↓
Temporary Agent process
  ↓
Model + Skills + Tools
  ↓
Result / Artifact
```

Architectural invariant:

> **Nora thinks. Platform coordinates. Agents work.**

Nora is the only persistent AI identity. Specialist Agents are not persistent people, roles, blueprints, or configurable identities. An Agent is an ephemeral OS process created for one Task execution.

## 3. Runtime processes

Carlos Office has three executable runtime roles:

```text
Back/platform.mjs
Back/src/runtime/nora.mjs
Back/src/runtime/AgentProcess.mjs
```

### 3.1 Platform

`Back/platform.mjs` is the persistent server process. It owns:

- HTTP/API routing;
- local persistence;
- Process and Workflow storage;
- Workflow execution coordination;
- Task/Attempt state;
- Tool and Skill registries;
- Tool execution;
- Authorizations;
- Conversations and Artifacts;
- Knowledge loading;
- Credentials and Workspace Variables APIs;
- Schedules;
- Office state synchronization;
- spawning, observing, cancelling, and terminating child processes.

The Platform coordinates execution but does not make model decisions itself.

### 3.2 Nora process

Nora runs as one persistent child process. The Platform sends structured decision requests to Nora through Node IPC and receives structured responses.

Nora owns reasoning, routing, planning, model/resource selection where unspecified, safe recovery decisions, capability creation, and result reporting.

### 3.3 Temporary Agent process

Each executable Task is performed by one temporary child process. The Agent process receives only the Task-specific execution context and exits after that Task reaches a terminal execution result.

## 4. Authority model

Carlos is the final authority.

Nora may:

- answer directly;
- ask for genuinely missing information;
- select an existing Process;
- create an ad-hoc Workflow;
- create or revise a reusable Process;
- select unspecified model, Tool, and Skill resources;
- create or update Tools and Skills when appropriate;
- monitor Workflows;
- review failed Tasks and request safe retries;
- summarize completed Workflows.

Explicit Carlos configuration is authoritative over Nora's runtime selection.

### 4.1 Current authorization behavior

Tool authorization is enforced centrally by the Platform.

A Tool may declare `requiresApproval: true`.

Current runtime behavior distinguishes between chat-originated and non-chat work:

- a Workflow carrying both `config.conversationId` and `config.sourceMessageId` is treated as originating from a direct Carlos request and therefore carries Carlos authority for Tool execution;
- otherwise, a Tool marked `requiresApproval` requires an explicit matching approval before it may execute;
- matching is scoped to the exact Workflow, Task, Tool, and Tool input;
- approved authorization records are consumed when used.

Agents never bypass this mechanism themselves because Tools execute in the Platform process, not in the Agent child process.

## 5. Nora

Nora is permanent and unique. She owns:

- Conversation interpretation;
- request routing;
- direct responses and clarification;
- Process/Workflow decisions;
- Task execution-resource selection;
- monitoring and safe recovery;
- result summarization;
- Tool and Skill creation when needed;
- reporting Workflow state back to Chat.

Nora's implementation-level operating definition and default model selection live at:

```text
Back/ObsidianVault/System/Nora.md
```

The Nora definition is separate from user-managed Knowledge.

A new Conversation starts with Nora's current default provider/model. Existing Conversations retain their own model selection. Updating a Conversation model updates active associated Workflow configuration where applicable.

There is no generic persistent Agent registry for Nora or specialist Agents.

## 6. Knowledge

Knowledge is Carlos's private persistent context layer.

It contains two documents:

```text
Back/ObsidianVault/Knowledge/Facts.md
Back/ObsidianVault/Knowledge/Instructions.md
```

### 6.1 Facts

`Facts.md` contains durable information Carlos wants Nora to consider across Conversations, such as preferences, project context, conventions, names, and recurring facts.

### 6.2 Standing Instructions

`Instructions.md` contains persistent behavioral instructions from Carlos. They guide Nora across Conversations unless Carlos's current explicit request supersedes them.

### 6.3 Injection behavior

Knowledge is loaded at Platform startup and current Knowledge is supplied automatically to:

- every Nora decision;
- every temporary Agent Task.

This prevents delegated work from losing Carlos's persistent context.

Knowledge is **not** automatically extracted from Conversations. Carlos edits it explicitly through Store.

Knowledge is not a secret store. Passwords, tokens, private keys, service-account keys, and other credentials belong in Credentials.

## 7. Conversations

A Conversation is Carlos's durable interaction context with Nora.

A Conversation stores:

- ID;
- optional title;
- Nora provider/model selection;
- ordered messages;
- associated Workflow IDs;
- Artifact references.

Conversation data is persisted under:

```text
Back/ObsidianVault/Conversations/<conversation-id>/thread.md
```

### 7.1 Messages

Messages record:

- message ID;
- actor;
- UTC timestamp;
- content;
- Artifact IDs;
- optional Workflow ID.

Carlos messages are persisted by the backend. Nora responses are appended as separate durable messages.

### 7.2 Optimistic Chat send

The frontend displays a Carlos message optimistically while its request is in flight.

The optimistic message is temporary frontend state. After the backend commits the real Conversation state, the frontend replaces its local Conversation with the persisted backend record.

The Chat frontend maintains a synchronous in-flight submission guard in addition to React UI state so one Enter/submit action cannot create duplicate backend requests before React finishes rendering the `sending` state. Repeated keyboard events while a request is active are ignored.

### 7.3 Message editing and replay

Only Carlos messages are editable.

Editing a Carlos message:

1. preserves history before that message;
2. replaces the selected message content;
3. removes later messages;
4. removes downstream Workflow references;
5. cancels/deletes downstream Workflows where applicable;
6. removes downstream approvals and Artifacts no longer retained;
7. replays the edited Carlos message through Nora.

Escape is the explicit frontend cancel path while editing.

## 8. Chat-originated Workflow reporting

Chat-originated Workflows store provenance in their Workflow config:

```text
conversationId
sourceMessageId
```

This provenance is used for lineage, authority, history editing, Office Map topology, and result reporting.

When a chat-originated Workflow reaches `completed`:

1. Carlos Office captures the Workflow result from completed Task Attempts;
2. Nora appends the result as a Conversation message linked to that Workflow;
3. the reporting path checks existing Conversation messages to avoid duplicate completion follow-ups;
4. concurrent completion-report attempts for the same Workflow are serialized;
5. Nora startup scans completed chat-originated Workflows and repairs a missing completion follow-up when possible.

This means completion reporting is not tied only to the original HTTP request. A Workflow that completes after Resume, Restart, retry, manual Operations execution, or backend restart can still report its result back to its originating Chat.

Blocked, failed, paused, and cancelled Workflow outcomes are also reported to the originating Conversation by the active background execution path.

## 9. Processes

A Process is a reusable directed graph definition for work worth repeating.

A Process contains:

- name;
- purpose;
- declared inputs;
- exactly one start node;
- exactly one end node;
- executable Task nodes;
- directed edges;
- optional UI layout metadata.

Processes are definitions, not runtime actors.

Carlos may edit Processes manually. Nora may create or revise Processes when requested.

Canonical Process definitions are stored under:

```text
Back/ObsidianVault/System/Processes/
```

## 10. Graph invariants

A valid Process or ad-hoc Workflow graph must satisfy:

- node types are only `start`, `task`, and `end`;
- exactly one start and one end exist;
- edges are `[fromTaskId, toTaskId]` pairs referencing existing nodes;
- no self-edge;
- no duplicate edge;
- start has no incoming edge;
- end has no outgoing edge;
- graph is acyclic;
- every node is reachable from start;
- every node can reach end;
- explicit Task provider/model values are configured as a pair;
- explicit Task input/Tool/Skill collections are arrays.

Legacy persisted `agent` fields may be tolerated during migration/loading, but they have no current execution authority and are removed from current definitions when rewritten/promoted.

## 11. Workflows

A Workflow is one durable runtime execution graph.

A Workflow may originate from:

- a reusable Process;
- an ad-hoc graph generated for one request;
- a Schedule;
- direct Operations/runtime control.

A Workflow stores:

- Workflow ID;
- optional Process name;
- status;
- inputs;
- config;
- start/end node IDs;
- runtime Task records;
- graph edges;
- captured result.

Canonical Workflow snapshots are stored under:

```text
Back/ObsidianVault/System/Workflows/
```

Operations retains historical Workflows. The Office Map intentionally does not display completed/cancelled/skipped Workflow history.

## 12. Tasks

A Task is the executable work unit inside a Process or Workflow.

An executable Task may define:

```text
objective
completion
inputs[]
output
provider + model   optional explicit pair
tools[]            optional explicit set
skills[]           optional explicit set
timeoutMs           optional
```

A Task does not define a persistent Agent identity.

Resource semantics:

- explicit provider/model means the Task requires that model;
- absent provider/model means Nora selects a valid model at runtime;
- explicit `tools[]` is authoritative, including an intentionally empty array;
- absent `tools` means Nora selects Tools;
- explicit `skills[]` is authoritative, including an intentionally empty array;
- absent `skills` means Nora selects Skills.

Provider and model must always be configured together.

## 13. Task execution selection

Before a ready Task runs, Carlos Office preserves every explicit Task constraint and asks Nora only for missing execution resources.

The resolved execution contract is:

```json
{
  "provider": "provider-name",
  "model": "model-name",
  "tools": [],
  "skills": []
}
```

There is no persistent specialist-Agent selection step.

Task input is resolved from:

- Workflow inputs;
- completed upstream Task outputs;
- declared Task `inputs[]`, when present.

## 14. Task Attempts

Each Task execution creates a durable Task Attempt.

An Attempt records:

- Attempt ID;
- ordinal attempt number;
- Workflow ID;
- Task ID;
- temporary Agent process ID and PID when available;
- provider/model;
- selected Tools and Skills;
- resolved input;
- start/end timestamps;
- status;
- output;
- error or blocked reason;
- related approval ID when blocked.

Attempts are execution history, not Agent identities.

## 15. Execution invariants and concurrency

### 15.1 One live Agent per Task

Carlos Office enforces a hard runtime invariant:

> **A given `(workflowId, taskId, invocationId)` may have at most one live Agent process. Map items may run concurrently under their Group limits.**

The Agent-process manager reserves that Workflow/Task/Invocation identity before forking the child process and rejects a second launch while the reservation is active.

### 15.2 Serialized Task execution transitions

ProcessEngine serializes Task execution state transitions per Workflow. Task preparation, Attempt creation, Task reservation, and terminal Attempt updates are coordinated so concurrent independent Tasks do not overwrite each other's execution state.

### 15.3 Orphaned running Attempts

Before starting a new Attempt for a Task, ProcessEngine checks persisted `running` Attempts.

If a persisted running Attempt has no corresponding live Agent process, it is closed as failed with an orphan/interruption reason and an `attempt.orphaned` event is recorded.

If a live Agent already exists for that Task, a second execution is rejected.

### 15.4 Parallel Tasks

Independent ready Tasks in one Workflow may execute concurrently.

Agents never communicate directly with each other. Coordination occurs only through Workflow state and persisted upstream outputs.

### 15.5 Active Workflow run deduplication

ProcessEngine maintains one active execution promise per Workflow. A second request to run the same currently active Workflow joins the existing run rather than creating an independent duplicate scheduler loop.

## 16. Temporary Agents

An Agent is one temporary child process executing one Task.

An Agent has no persistent:

- identity;
- persona;
- definition file;
- default model;
- default Tools;
- default Skills;
- reusable specialist configuration.

At spawn time it receives:

- Workflow ID and Task ID;
- resolved input;
- objective;
- completion criteria;
- provider/model;
- allowed Tool metadata;
- selected Skills;
- current Knowledge.

The process exists only for the Task lifetime.

Runtime identity is the generated process ID (`agent-<pid>`) and PID.

### 16.1 Agent timeout

A Task may provide `timeoutMs`. If omitted, the current default Agent-process timeout is five minutes. A timeout aborts the Platform-side execution signal, terminates the child process, and records a failed execution result.

## 17. Tools

A Tool performs executable work.

A Tool defines:

- name;
- description;
- input contract;
- optional output contract;
- executable implementation;
- optional provider/model metadata;
- `requiresApproval` policy.

Only Tools selected for the current Task are exposed to the temporary Agent.

Tools execute in the Platform process. Agents request Tool calls through IPC.

Canonical Tool files live under:

```text
Back/tools/
```

Current built-in Tool set includes:

```text
alarm-trigger
credential-store
http
play-audio
read-file
run-powershell
workspace-variables
write-file
```

Nora may create or update Tools when reusable executable capability is needed.

## 18. Skills

A Skill is reusable procedural guidance/context, not an Agent persona.

Only Skills selected for the current Task are injected into that Agent execution.

Canonical Skill storage supports both:

```text
Back/skills/<name>.md
Back/skills/<name>/SKILL.md
```

Native flat `<name>.md` files take precedence if both representations exist.

The Skills registry watches the Skills directory recursively and exposes a revision counter so the frontend can react to installed/changed Skills without a full platform restart.

## 19. Credentials

Credentials are protected authentication profiles managed through **Store → Credentials**.

Credentials are stored in the local SQLite database:

```text
Back/.carlos-office/credentials.db
```

The current database stores credential secrets and Workspace Variables in separate tables.

Supported credential types are:

```text
bearer
api-key
basic
custom
google-workspace
```

A normal credential profile stores:

- service identifier;
- type;
- secret;
- allowed hosts;
- header name;
- optional scheme;
- updated timestamp.

Credential metadata may be listed/read by Agents through the `credential-store` Tool, but the secret value is never returned to an Agent or model provider.

The credential database is local but **is not encrypted at rest by Carlos Office**. Storing a secret in SQLite removes the need for loose key files but does not itself provide disk encryption.

## 20. Credential-bound HTTP

The `http` Tool can request credential injection using only:

```json
{
  "auth": {
    "service": "credential-service-name"
  }
}
```

The Agent does not supply or receive the actual secret.

Credential application is performed locally by the Platform and enforces the credential's allowed-host policy.

For authenticated requests:

- the configured credential header is injected locally;
- automatic redirects are disabled so credentials are not forwarded to a redirect target;
- injected credential values are redacted from response bodies and headers when encountered;
- sensitive response headers such as `authorization`, `cookie`, `proxy-authorization`, and `set-cookie` are omitted;
- normal Tool response-size and timeout limits still apply.

## 21. Google Workspace service-account credential

Carlos Office supports a dedicated `google-workspace` credential type using a Google service-account JSON key with Google Workspace Domain-Wide Delegation.

### 21.1 Storage

The complete service-account JSON is stored as the credential secret inside the same SQLite credential database. Carlos Office does not require the JSON key to remain as a standalone file.

The service-account JSON secret is write-only through the application API/UI and is not returned in credential metadata.

### 21.2 Delegated user

A Google Workspace credential stores one configured Workspace user email (`subject`) to impersonate.

The Agent cannot supply an arbitrary subject at Tool-call time.

### 21.3 OAuth scopes

Carlos Office accepts only its configured Google Workspace scope allowlist. The current supported scope set includes Gmail, Calendar, Drive, Docs, Sheets, Slides, Keep, Chat, and Google Meet scopes used by the Store form.

`cloud-platform` and arbitrary Google Cloud scopes are not accepted by this credential type.

### 21.4 Token exchange

When the credential is used:

1. Carlos Office parses the stored service-account JSON;
2. signs an RS256 JWT assertion locally;
3. includes the fixed delegated `subject` and configured Workspace scopes;
4. exchanges the assertion at `https://oauth2.googleapis.com/token`;
5. receives a short-lived access token;
6. caches the token until close to expiration;
7. injects the access token into the outbound Workspace request.

The service-account private key and access token do not enter Agent/model context.

### 21.5 Allowed Workspace routes

Google Workspace authentication is restricted to the approved Workspace API hosts/routes for:

- Gmail;
- Calendar;
- Drive;
- Docs;
- Sheets;
- Slides;
- Chat;
- Keep;
- Meet.

Google Cloud resource APIs are not part of this credential profile.

## 22. Workspace Variables

Workspace Variables are shared **non-secret** named values managed through **Store → Workspace Variables**.

They are stored in the `workspace_variables` table inside:

```text
Back/.carlos-office/credentials.db
```

A variable stores:

- key;
- value;
- optional description;
- updated timestamp.

Keys must start with a letter and may contain letters, numbers, `.`, `_`, or `-`, up to 128 characters.

Workspace Variables are not automatically injected into every model context. Temporary Agents may read them through the `workspace-variables` Tool when that Tool is selected for the Task.

Agent access is deliberately read-only:

```text
get
list
```

Carlos manages create/update/delete operations from Store.

Variable values are intentionally visible to Agents and model providers and must therefore never be used for secrets.

## 23. Store surface

Store owns three persistent configuration/context classes:

1. **Credentials** — authentication material and host/policy metadata; secrets never enter normal model context.
2. **Workspace Variables** — non-secret named runtime values available through the read-only Agent Tool.
3. **Knowledge** — persistent Facts and Standing Instructions automatically injected into Nora and temporary Agent context.

Store is the replacement for the former standalone Credentials page.

## 24. Authorizations

Authorization is a cross-cutting authority boundary owned by Carlos.

Authorization records contain:

- action;
- requesting Agent/process identity;
- Workflow/Task/Tool/input context;
- status;
- timestamps.

Approvals are visible as a global interrupt/inbox and may also be resolved contextually from the Office Map/Workflow context.

## 25. Artifacts

Artifacts are files associated with a Conversation.

Artifact metadata and files are persisted inside the Conversation's local storage area. Messages may reference Artifact IDs.

Text-like request Artifacts may be loaded into Nora request context. Binary/non-text Artifacts remain referenced without being blindly decoded into text.

Editing earlier Conversation history removes downstream Artifacts that are no longer retained by the surviving history.

Carlos Office does not impose an artificial backend upload/request-size cap beyond runtime/tool-specific constraints.

## 26. Schedules

A Schedule triggers a reusable Process.

Supported timing forms are:

- a one-time `at` timestamp;
- a recurring five-field cron expression.

Cron evaluation is in UTC.

A Schedule stores:

- ID;
- Process;
- enabled state;
- timing configuration;
- Process inputs;
- Workflow config;
- last run;
- next run.

Scheduled Workflows normally have no Conversation parent unless Conversation provenance is explicitly supplied.

## 27. Workflow controls

Carlos Office supports Workflow lifecycle controls including:

- run;
- pause/stop;
- resume;
- restart;
- cancel;
- delete.

Task-level controls include cancellation and failed-Task review/retry paths where applicable.

Cancelling a Workflow:

- marks the run state cancelled;
- terminates active Agent child processes for that Workflow;
- aborts Platform-side Tool signals;
- prevents new Tasks from being launched by that active run;
- persists cancelled Task/Workflow state.

A side effect that already completed cannot be undone by cancellation.

## 28. Recovery after backend restart

Startup runs vault migration/cleanup before loading runtime state.

Persisted Workflow recovery reads from:

```text
Back/ObsidianVault/System/Workflows/
```

If the backend stopped while a Workflow/Task Attempt was running:

- persisted `running` Task state is converted to a blocked/interrupted state;
- persisted `running` Attempts are closed as failed with a restart interruption reason;
- the Workflow becomes blocked for explicit inspection/recovery;
- a `workflow.interrupted` event is recorded.

The backend does not pretend an OS Agent process survived a backend restart.

## 29. Events

Carlos Office maintains append-only operational event history for diagnostics and lifecycle tracing.

Events cover important changes such as:

- Workflow creation/completion/deletion/interruption;
- Task status changes;
- Attempt start/completion/failure/block/cancellation/orphan recovery;
- Agent process start/stop;
- Tool execution;
- authorization activity;
- Nora request failures and Workflow reporting;
- schedule failures;
- migration/recovery events.

Events are persisted under:

```text
Back/ObsidianVault/System/Events/
```

## 30. Office state synchronization

The frontend receives background-changing office state through the `/ping` long-poll service instead of aggressive periodic polling.

The Office state snapshot tracks:

- Nora state;
- Workflows;
- Approvals;
- active Agent processes;
- Skills revision;
- Conversations revision.

The Conversations revision is derived from Conversation IDs, message counts, and latest-message identity/timestamp.

When the active Chat detects a new Conversations revision, it reloads the active Conversation. This is how asynchronous Workflow completion messages appear in Chat without a hard page refresh.

## 31. Office Map

Office Map is the live topology and contextual operational-control surface.

Canonical topology:

```text
Nora
 ├─ Conversation
 │    ├─ Workflow
 │    │    └─ temporary Agent process
 │    └─ Workflow
 ├─ Conversation
 └─ scheduled / non-chat Workflow
      └─ temporary Agent process
```

### 31.1 Visibility rules

Office Map represents current/live office state rather than historical Workflow archives.

Completed, cancelled, and skipped Workflows are hidden from the map. Historical Workflow data remains available in Operations.

Failed/attention states remain visible because they still require inspection.

### 31.2 Visual hierarchy

Node size follows ownership hierarchy:

```text
Nora > Conversation > Workflow > temporary Agent process
```

Current nominal node radii are approximately:

```text
Nora                 0.34
Conversation         0.17
Workflow             0.105–0.13 depending on state
Temporary Agent      0.08
```

A Workflow must not visually dominate its parent Conversation.

### 31.3 Interaction

Office Map currently supports:

- rotate/pan-like camera interaction by dragging empty space;
- node repositioning;
- persisted map layout/view in browser local storage;
- zoom;
- reset;
- search;
- All / Active / Chats / Workflows filters;
- contextual navigation to Chat or Operations;
- contextual approval actions;
- draggable inspectors constrained to the visible map area.

### 31.4 Nora inspector

Nora's inspector includes:

- Nora runtime status;
- Nora PID;
- active provider/model;
- default new-Conversation model configuration.

The model configuration belongs inside Nora's inspector rather than as an unrelated floating panel.

## 32. Chat surface

Chat is the Carlos ↔ Nora command surface.

It manages:

- Conversation list;
- new Conversation creation;
- Conversation rename/delete;
- Conversation-level model selection;
- messages;
- optimistic send;
- duplicate-submit protection;
- attachments/Artifacts;
- Carlos message editing/replay;
- current-work cancellation where supported;
- Workflow links to Operations;
- Markdown rendering;
- asynchronous Conversation refresh after background Workflow updates.

Chat is not a Workflow graph designer.

## 33. Processes surface

Processes is the reusable-work design surface.

It includes:

- Process library;
- graph editor;
- persisted node layout;
- Task configuration;
- explicit-or-Nora-selected provider/model;
- multiple Tools;
- multiple Skills;
- Process inputs;
- Schedules.

A Task inspector does not expose a static Agent selector because static specialist Agents do not exist.

## 34. Operations surface

Operations is the Workflow execution inspection/control surface.

It exposes runtime and historical information including:

- Workflow graph/state;
- Task states;
- Attempt history;
- currently running Agent process when present;
- Agent process ID/PID;
- provider/model;
- Tools;
- Skills;
- outputs/errors;
- approvals;
- events;
- valid Workflow/Task controls.

Persisted Attempt history and live Agent-process state are distinct concepts. A running Agent shown by runtime state represents an actual active child process; historical Attempts remain durable records after the Agent exits.

## 35. Capabilities surface

Capabilities manages reusable abilities available to Task execution.

It contains exactly two durable capability classes:

- **Tools** — executable abilities;
- **Skills** — reusable methodology/context.

Persistent specialist Agents are not a capability class.

## 36. Current local persistence layout

The canonical Obsidian vault has no numeric folder prefixes.

```text
Back/ObsidianVault/
├── Conversations/
├── Knowledge/
│   ├── Facts.md
│   └── Instructions.md
└── System/
    ├── Nora.md
    ├── Processes/
    ├── Workflows/
    ├── Schedules/
    ├── Events/
    └── Runtime/
```

Additional local SQLite state lives under:

```text
Back/.carlos-office/credentials.db
```

That SQLite database currently contains:

- credential profiles/secrets;
- Workspace Variables.

Runtime child-process state exists only in memory while the process is alive. Durable execution facts belong in Workflow Attempts and Events.

## 37. Vault migration and cleanup

At Platform startup, vault maintenance migrates legacy directories:

```text
30-Conversations → Conversations
90-System        → System
```

It then removes obsolete directories:

```text
00-Inbox
15-Memory
20-Agents
40-Jobs
45-Tasks
50-Artifacts
60-Workspace
System/Agents
System/Runtime/Agents
```

There is no canonical specialist-Agent definition directory.

`40-Jobs` is not renamed to `40-Workflows`; Workflows already have their canonical location under `System/Workflows`.

## 38. Startup sequence

The Platform currently initializes persistent/runtime systems in this order:

1. prepare/migrate vault structure;
2. load Knowledge;
3. load Events;
4. load Authorizations;
5. load Tools;
6. load Skills;
7. load Nora definition;
8. load Process definitions;
9. reconcile interrupted persisted Workflows;
10. load Workflows into runtime memory;
11. load Conversations;
12. load Schedules;
13. initialize Nora and reconcile missing completed-Workflow Chat reports;
14. start HTTP server;
15. start scheduler.

This order ensures Workflow recovery happens against persisted files before the in-memory Workflow registry is populated.

## 39. Canonical repository structure

```text
Back/
  platform.mjs
  tools/
    alarm-trigger.mjs
    credential-store.mjs
    http.mjs
    play-audio.mjs
    read-file.mjs
    run-powershell.mjs
    workspace-variables.mjs
    write-file.mjs
  skills/
  src/
    Router.mjs
    config.mjs
    controllers/
      ArtifactController.mjs
      AuthorizationController.mjs
      ConversationController.mjs
      CredentialController.mjs
      EventController.mjs
      KnowledgeController.mjs
      NoraController.mjs
      OfficeStateController.mjs
      ProcessController.mjs
      ScheduleController.mjs
      VariableController.mjs
    providers/
      OllamaProvider.mjs
    registry/
      Nora.mjs
      Skills.mjs
      Tools.mjs
    runtime/
      Agent.mjs
      AgentProcess.mjs
      AgentProcesses.mjs
      NoraProcess.mjs
      nora.mjs
    services/
      CredentialService.mjs
      KnowledgeService.mjs
      NoraCreationService.mjs
      OfficeStateService.mjs
      ProcessEngine.mjs
      VariableService.mjs
      VaultMaintenanceService.mjs
      WorkflowGraphService.mjs
      WorkflowRecoveryService.mjs
  ObsidianVault/
    Conversations/
    Knowledge/
    System/
  .carlos-office/
    credentials.db

Front/
  src/
    App.jsx
    AppContext.jsx
    api.js
    components/
    lib/
    pages/
      CapabilitiesPage.jsx
      ChatPage.jsx
      OfficeMapPage.jsx
      OperationsPage.jsx
      ProcessesPage.jsx
      StorePage.jsx
    styles/
```

## 40. Time model

Persisted timestamps are UTC ISO-8601 values.

- Events, messages, Artifacts, Attempts, Authorizations, interruptions, and Schedule timestamps are persisted in UTC.
- one-time Schedule values are normalized to UTC;
- cron schedules are evaluated in UTC;
- the frontend localizes timestamps for display/input convenience.

## 41. Implementation constraints

Current implementation constraints are:

- backend uses Node.js pure ESM `.mjs` modules;
- frontend uses React 18 + Vite + JSX/JS;
- Node.js 22.12+ is required;
- local SQLite uses `node:sqlite`;
- current model-provider implementation is Ollama-compatible through `OllamaProvider.mjs`;
- frontend layout uses Flexbox rather than a CSS Grid architecture;
- browser API access is restricted to the configured frontend origin;
- no distributed orchestration layer;
- no event-sourcing architecture;
- no generic multi-user SaaS machinery;
- no dependency-injection framework;
- no persistent specialist-Agent blueprint framework;
- no default-model inheritance through specialist Agents;
- no direct Agent-to-Agent communication;
- no unnecessary abstraction for hypothetical future use.

When complexity is optional, delete it. Preserve only complexity inherent to the product behavior.


## Workflow reliability clarifications

- Tool contracts use full JSON Schema validation and valid examples. Tool execution has a cancellable deadline and an explicit replay policy; unknown/write actions are not automatically replayed.
- Completed invocation data and artifacts are preserved. Map continuation applies only to ordinary failures, never authorization blocks or cancellation.
- Resume reuses compatible completed invocation checkpoints. Changed execution definitions or inputs invalidate results and downstream work; layout-only edits preserve execution results.
- Lifecycle controls serialize state changes and wait for the old task execution to settle before restart or cleanup. Restart keeps Attempt history but starts a new execution revision.
- Producer files remain available until explicit workflow restart, cancellation, or deletion. Startup preserves files required by interrupted checkpoints.
- Interrupted actions with unknown side effects require inspection before explicit restart. Nora cannot automatically replay these actions.
