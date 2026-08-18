# Carlos Office — Functional Specification

## 1. Purpose

Carlos Office is a private multi-agent operating system for Carlos's company.

Carlos is the CEO. Nora is his single persistent Chief of Staff. Nora receives requests, creates and manages workflows,
coordinates specialist agents, watches runtime events, resolves safe operational blockers, and reports decisions that
require Carlos's authority.

The platform is not a general-purpose chatbot with several permanent personalities. It is an operating environment in
which one manager coordinates temporary workers through explicit processes, tasks, tools, skills, permissions, and
observable runtime state.

This document specifies the required behavior from a functional perspective so the project can be recreated without
depending on the current implementation.

## 2. Mandatory implementation guidance

Before analyzing, generating, or modifying code, read `MANDATORY_CODING_STANDARD.md` from the repository root in full.

That file is authoritative for:

- JavaScript, `.mjs`, and JSX conventions;
- module and file structure;
- graceful error handling;
- function and abstraction limits;
- validation and testing requirements;
- the single-entry SCSS architecture;
- mobile-first independent BEM classes;
- themes, breakpoints, layout, and overflow rules.

If generated code conflicts with `MANDATORY_CODING_STANDARD.md`, the coding standard takes precedence.

TypeScript and TSX must not be introduced unless explicitly approved.

### 2.1 Simplest correct implementation

The simplest implementation that satisfies the functional requirement is the correct implementation.

This specification describes what Carlos Office must do. It does not require:

- enterprise-scale infrastructure;
- transaction systems;
- defensive duplication;
- multiple validation layers;
- exhaustive telemetry;
- compatibility layers;
- speculative future functionality.

Carlos Office is a local single-user application. Direct code, simple persistence, and ordinary Node primitives are preferred over frameworks, engines, and defensive machinery.

## 3. Product principles

1. Carlos retains final authority.
2. Nora owns orchestration.
3. There is exactly one live Nora instance.
4. Specialist agents are blueprints, not permanent running services.
5. A specialist instance exists only while participating in a workflow.
6. Processes are reusable definitions; workflows are their live in-memory executions.
7. Workers do not mutate workflows directly.
8. Nora changes runtime state through validated, auditable commands.
9. Skills describe how to work; tools perform specific executable actions.
10. Skills never grant permissions.
11. Permissions are explicit and cannot be silently broadened.
12. Failures must be visible, inspectable, and truthfully represented.
13. Safe recovery may be automatic; authority and business decisions return to Carlos.
14. The Office Map is the primary operational interface.

## 4. Human and system actors

### 4.1 Carlos

Carlos is the CEO and final human authority.

Carlos can:

- give Nora requests;
- inspect processes, workflows, tasks, attempts, workers, errors, and permissions;
- approve or deny requested authorization scopes;
- provide missing business input;
- pause, resume, cancel, retry, skip, or reassign work where policy permits;
- assess completed work;
- configure Nora and agent blueprints from the Office Map;
- install or remove skills;
- inspect and invoke installed tools;
- change platform settings.

### 4.2 Nora

Nora is a singleton Chief of Staff and runtime manager.

Nora is always conceptually present while the backend is running. Creating a workflow must never create another Nora.

Nora must:

- listen to the office event bus;
- receive and classify Carlos's requests;
- choose or create the appropriate process execution;
- inspect every workflow's current state and revision;
- validate workflow consistency;
- identify the next executable tasks;
- instantiate suitable specialist workers;
- monitor execution, attempts, timeouts, tools, and permissions;
- update safe runtime parameters when justified;
- recover stuck workflows when recovery is safe and bounded;
- release specialist instances when their task ends;
- verify that a recovery produced actual progress;
- escalate unresolved blockers to Carlos with evidence and clear choices;
- provide a truthful final handover.

Nora must not:

- create another Nora instance;
- approve Carlos's permissions on his behalf;
- silently broaden an agent's scopes;
- hide, erase, or misrepresent a failure;
- claim recovery because a command was accepted without observing subsequent progress;
- mutate process source code to alter a running workflow;
- allow workers to edit runtime state directly.

### 4.3 Specialist agent blueprints

The initial specialist blueprints are:

| Agent | Function |
| --- | --- |
| Dex | Development and automation |
| Iris | Research and intelligence |
| Luma | Creative direction |
| Marco | Commercial strategy |
| Vera | Quality control and acceptance |

Each blueprint defines:

- identity and role;
- system instructions;
- enabled state;
- model/provider policy;
- task timeout;
- maximum tool rounds;
- maximum concurrent instances;
- allowed tools;
- available skills;
- other bounded runtime defaults.

A blueprint is configuration. It does not perform work until Nora creates a workflow-bound instance from it.

### 4.4 Specialist agent instances

An agent instance is a temporary worker created for one task in one workflow.

An instance must have:

- a unique instance identifier;
- one blueprint identifier;
- one workflow identifier;
- one task identifier;
- a lifecycle state;
- creation and release timestamps;
- a release reason.

One instance handles one task at a time. It is released after completion, failure, cancellation, or reassignment.

## 5. Core domain model

### 5.1 Process definition

A process definition is a durable, reusable recipe.

It contains:

- definition identifier;
- immutable version;
- name and description;
- lifecycle state such as draft, published, or archived;
- ordered or dependency-linked task definitions;
- default agent blueprint assignments;
- required tools, skills, and authorization scopes;
- timeout and attempt policies;
- quality and completion gates where applicable.

Publishing creates an immutable version. Existing workflows remain bound to the version from which they were created.

### 5.2 Workflow runtime

A workflow is a live in-memory execution of one process version.

It contains:

- workflow identifier;
- process definition identifier and version;
- originating request and conversation identifiers when applicable;
- objective;
- priority;
- current status;
- monotonically increasing revision;
- creation, update, progress, and completion timestamps;
- instantiated task runtimes;
- current failure or blocker;
- runtime edit history;
- final handover and assessment when completed.

Required workflow states:

- `queued`;
- `running`;
- `paused`;
- `waiting_authorization`;
- `waiting_input`;
- `completed`;
- `failed`;
- `cancelled`.

### 5.3 Task runtime

A task runtime is one process step inside one workflow.

It contains:

- task identifier;
- name and instructions;
- task type;
- dependency identifiers;
- assigned blueprint;
- assigned runtime instance, when active;
- required tools, skills, and scopes;
- timeout and maximum attempts;
- current status;
- attempt history;
- input;
- output or result summary;
- failure evidence;
- start and completion timestamps;
- generated artifacts when applicable.

Required task states:

- `pending`;
- `ready`;
- `running`;
- `waiting_authorization`;
- `waiting_input`;
- `completed`;
- `failed`;
- `skipped`;
- `cancelled`.

### 5.4 Task attempt

Every execution try creates a separate attempt record.

An attempt records:

- attempt number and identifier;
- worker instance;
- model/provider route;
- start and completion timestamps;
- tool activity;
- returned result;
- cancellation or timeout reason;
- structured failure category and message.

Previous attempts remain inspectable after retry.

### 5.5 Authorization request

An authorization request binds a specific scope request to a workflow and task.

It contains:

- request identifier;
- workflow and task identifiers;
- requesting worker instance;
- exact requested scopes;
- reason;
- pending, approved, denied, or expired state;
- creation and resolution timestamps;
- bounded grant details when approved.

Approval resumes only the affected work and must not become an unlimited blanket permission unless Carlos explicitly
creates such a policy.

### 5.6 Runtime event

Every meaningful transition emits an event.

An event contains:

- event identifier and type;
- timestamp;
- related workflow, task, agent, instance, request, tool, or authorization identifiers;
- concise summary;
- structured payload needed for diagnostics.

Events are the information stream Nora watches to manage the office.

### 5.7 Runtime error

Errors are first-class operational records, not console-only text.

An error should identify:

- category and layer;
- message and safe diagnostic detail;
- timestamp and duration;
- workflow, task, attempt, request, conversation, agent, tool, provider, and model where applicable;
- timeout, status code, and retryability where applicable.

Operations and workflow-detail views must expose these records.

## 6. Event-driven runtime

The backend has one office event bus.

Producers include:

- HTTP request intake;
- the workflow runtime store;
- worker execution;
- tool execution;
- model providers;
- authorization resolution;
- schedules;
- Nora's recovery actions.

Nora subscribes to relevant events and reacts to them. Nora does not poll unrelated state continuously when an event can
announce the change.

Important event categories include:

- workflow created or updated;
- task ready, started, completed, failed, or blocked;
- agent instance created, assigned, or released;
- authorization requested or resolved;
- model or tool failure;
- timeout or cancellation;
- stuck workflow detected;
- recovery attempted or confirmed;
- escalation sent to Carlos;
- workflow completed or cancelled.

The frontend receives runtime events through a server-sent event stream and may use bounded polling as a fallback.

## 7. Nora's management loop

For every active workflow, Nora follows this loop:

1. Read the latest workflow state and revision.
2. Validate the process version, tasks, dependencies, assignments, and capability requirements.
3. Identify active blockers and recent events.
4. Determine which tasks are ready.
5. Allocate an available worker instance for each permitted ready task.
6. Observe attempts, tool calls, provider activity, and progress timestamps.
7. On completion, release the worker and unlock dependent tasks.
8. On failure or stagnation, classify the problem.
9. Apply one safe recovery action or escalate to Carlos.
10. Observe the result before declaring recovery.
11. When all required tasks pass, perform the final handover.

Nora must avoid recursive event storms, duplicate dispatch, duplicate escalation, and parallel use of her singleton
instance.

## 8. Workflow validation

Workflow validation is a Nora responsibility.

Validation checks at least:

- the process definition and version exist;
- task identifiers are unique;
- dependencies exist and are not cyclic;
- required assignments reference enabled blueprints;
- required tools and skills are installed;
- required scopes are known;
- a task is not running under two instances;
- one instance is not assigned to two tasks;
- terminal tasks cannot return to running without a valid retry command;
- workflow state agrees with task state;
- the workflow revision is current before mutation.

Invalid workflows must be paused or prevented from dispatching. Nora records the validation error and either repairs a safe
inconsistency or escalates it.

## 9. Stuck-workflow recovery

Stuck-workflow recovery is also a Nora responsibility, not a separate autonomous agent.

A workflow may be stuck when:

- a running task exceeds its timeout or progress threshold;
- a worker disappears or becomes unavailable;
- a model provider fails or returns no usable response;
- a tool call fails or reaches a bounded retry limit;
- a required permission is pending;
- required human input is absent;
- a dependency cannot advance;
- a task exhausted its attempts;
- runtime state is internally inconsistent.

Safe automatic recovery can include:

- retrying an idempotent task within its attempt limit;
- releasing a dead worker and creating another instance;
- reassigning a task to a compatible enabled blueprint;
- extending an obviously inadequate timeout within configured bounds;
- resuming work after an approved scope or supplied input;
- reconciling a recoverable state mismatch;
- changing priority or other non-authority runtime parameters.

Nora must escalate instead of auto-recovering when:

- Carlos's permission is required;
- a business decision or missing requirement is needed;
- recovery would broaden authority;
- an external side effect may be duplicated;
- a required quality gate would be bypassed;
- attempts are exhausted;
- the appropriate correction is ambiguous or materially risky.

An escalation must explain:

- what is blocked;
- the evidence;
- what Nora already tried;
- the exact decision or permission needed;
- the consequence of each practical choice.

## 10. Runtime edits

Nora edits a running workflow through a command boundary, not by editing JavaScript or directly mutating an object.

Every runtime edit includes:

- workflow identifier;
- expected workflow revision;
- command name;
- validated command payload;
- actor identifier;
- timestamp.

The runtime rejects stale revisions with a conflict response. A successful edit increments the workflow revision and emits an
audit event.

Required runtime commands include:

- set priority;
- set task timeout;
- assign or reassign blueprint;
- retry task;
- skip task when policy permits;
- provide human input;
- resolve authorization;
- pause workflow;
- resume workflow;
- cancel workflow.

The command layer must enforce state transitions and authority boundaries.

## 11. Tools

A tool is a code-level executable function for one specific capability.

Each tool is an `.mjs` module containing:

- a unique name;
- a concise description;
- a parameter schema;
- required authorization scopes;
- a side-effect classification;
- one executable function;
- a structured success or failure result.

A tool may perform one step or a cohesive sequence of steps, but it remains one function from the agent's perspective.

Examples:

- read one project file;
- list project files;
- fetch one URL;
- search the web;
- run a bounded project check;
- write one approved artifact;
- send one approved message.

Editing the module edits the tool itself. Tool behavior must not be hidden in prompts or duplicated across unrelated
registries.

Tool execution must:

- validate parameters;
- verify required scopes;
- use bounded timeouts;
- support cancellation where applicable;
- redact sensitive values;
- record activity and failures;
- return a predictable structured result;
- never report success after a required step failed.

## 12. Skills

A skill is an opinionated Markdown procedure describing how an agent should execute a type of work.

Each installed skill lives at:

```text
Back/skills/<skill-name>.md
```

A skill descriptor should include:

- unique name;
- description;
- version;
- when to use it;
- required procedure;
- constraints;
- completion conditions;
- references or supporting files when necessary.

The platform must support:

- listing installed skills;
- reading the complete descriptor;
- installing from an approved local path or URL;
- validating name, size, and structure;
- atomically saving the descriptor;
- removing a skill;
- assigning available skills to blueprints.

Skills guide decisions. They cannot execute by themselves, grant permission, add undeclared tools, or override the
mandatory coding standard.

## 13. Requests and chat

Chat is Carlos's direct request channel to Nora.

Submitting a message must:

1. save the user message in its conversation;
2. create or select the appropriate process workflow;
3. return promptly with confirmation that Nora accepted and started managing the work;
4. continue execution in the background;
5. expose the live workflow card in the conversation;
6. stream or refresh subsequent runtime state;
7. notify Carlos when input or authorization is needed;
8. attach Nora's final handover to the conversation.

The HTTP chat request must not remain open for the full duration of a multi-agent workflow.

Conversation history supports:

- active, archived, and trash lifecycles;
- rename;
- reversible deletion;
- permanent purge;
- attachments;
- message editing with visible impact;
- links to related workflows and artifacts.

## 14. Office Map

The Office Map is the central visual and operational interface.

It displays:

- Nora and specialist blueprints;
- live temporary agent instances;
- active and attention-required workflows;
- selected conversations;
- links between Nora, workflows, tasks, and workers;
- recent event packets;
- availability and capacity.

The map must preserve the user's camera zoom, rotation, and node layout between navigation events.

Selecting an agent opens its activity and configuration inspector. Agent configuration belongs only in the Office Map;
a separate Agents page is not required.

Selecting a workflow opens a workflow-detail modal containing:

- identity, process version, objective, status, priority, and progress;
- current task and worker;
- complete task timeline;
- attempts and tool activity;
- model/provider route;
- errors and timeout evidence;
- authorization requests;
- runtime edit history;
- artifacts;
- Nora's diagnosis and recovery activity;
- controls appropriate to the current state;
- final quality and Carlos's assessment when completed.

## 15. Processes

The Processes page opens on the process index, not an arbitrary detail view.

It supports:

- listing reusable process definitions;
- filtering by lifecycle;
- searching;
- creating a draft;
- editing tasks and dependencies;
- assigning blueprint, tool, skill, timeout, attempts, and scope requirements;
- validating graph integrity;
- publishing an immutable version;
- archiving a definition;
- starting a workflow from a published definition;
- inspecting previous versions.

The process graph must visually connect nodes correctly. Start and end nodes must use clearly structured content and
must not depend on decorative ports that do not serve interaction or connection geometry.

## 16. Authorizations

The Authorizations page is Carlos's permission inbox.

It displays:

- requesting workflow, task, worker, and tool;
- exact requested scopes;
- reason and intended side effect;
- request time and expiry;
- approval and denial controls;
- bounded grant options where applicable.

Resolving a request emits an event. Nora re-reads the affected workflow, passes approved scopes only to the affected worker,
and resumes execution when safe.

## 17. Operations and diagnostics

The Operations page provides a truthful view of runtime health.

It includes:

- active, paused, failed, and authorization-blocked workflows;
- task attempts and terminal failures;
- queue and execution timing;
- provider health;
- agent capacity;
- recovery attempts and confirmed recovery rate;
- quality summaries;
- recent runtime errors;
- breakdowns by process, workflow, task, agent, tool, provider, and model.

Every displayed error must be expandable and contain useful safe context. Runtime failures cannot exist only in backend
console output.

## 18. Tools and skills pages

The Tools page lists actual executable functions, not abstract capability labels.

It provides:

- search and filtering;
- availability;
- description and version when applicable;
- parameter contract;
- side-effect and authorization information;
- allowed agents;
- bounded manual invocation as Nora;
- structured result and error inspection.

The Skills page provides:

- installation source input;
- installed skill list;
- full descriptor view;
- version and integrity information;
- blueprint availability;
- removal;
- clear separation between guidance and executable tools.

## 19. Settings

Settings use one vertically scrollable page with sections instead of a tabbed interface.

Sections include:

- general runtime policy;
- model catalog and routing;
- providers;
- channels;
- schedules;
- context behavior;
- retention and recovery.

Global settings provide defaults. Agent and process-task policies may narrow or override those defaults without mutating
the catalog for unrelated work.

## 20. Backend boundaries

The backend should expose clear capability boundaries:

- domain definitions and state transitions;
- in-memory workflow runtime store;
- event bus;
- Nora orchestrator;
- worker executor;
- model provider adapters;
- tool registry and execution;
- skill registry and installation;
- authorization handling;
- conversation handling;
- HTTP routing and response mapping.

Do not recreate a single large process-engine file containing routing, persistence, provider calls, permissions, execution, and presentation mapping together.

Keep the runtime cohesive and direct. Do not compensate for the old monolith by generating dozens of single-use wrapper functions or artificial service layers.

## 21. Failure behavior

Recoverable failures should log context, create a runtime error record, and return a predictable neutral or structured failure result.

The backend should continue serving unaffected work when one provider, tool, task, or workflow fails.

Exceptions are reserved for unsafe startup state, security violations, corrupted invariants, or framework boundaries that require them, as defined in `MANDATORY_CODING_STANDARD.md`.

External operations require:

- timeout;
- cancellation where applicable;
- bounded retries;
- retryability classification;
- no retry for validation, authentication, or deterministic programming errors;
- side-effect reconciliation before retrying non-idempotent work.

## 22. Security and authority

- Treat browser input, stored data, skill descriptors, tool parameters, and provider responses as untrusted boundaries.
- Never expose credentials in APIs, events, logs, tool results, or error details.
- Skill installation must validate path, URL, size, name, and file structure.
- Project file tools must remain inside approved roots.
- Network tools require explicit network scopes.
- Workers receive only the scopes needed for their current task.
- Nora may recommend an authorization decision but cannot make Carlos's protected decision.
- Runtime edits must be revision checked and audited.

## 23. Minimum API capabilities

The backend must provide endpoints or equivalent interfaces for:

- health and runtime events;
- chat and conversation lifecycle;
- Office Map topology;
- agent blueprint read and update;
- model discovery;
- process definitions, versions, publication, and workflow creation;
- workflow list, detail, runtime actions, input, and assessment;
- authorization list and resolution;
- tool list, refresh, and invocation;
- skill list, detail, installation, assignment, and removal;
- operations and runtime errors;
- platform settings, integrations, and schedules;
- artifact retrieval where artifacts are supported.

The frontend should consume normalized views without learning internal storage or provider details.

## 24. Functional acceptance criteria

The platform is functionally acceptable when all of the following are true:

1. Carlos can send Nora a request and receive immediate acknowledgement with a visible workflow.
2. Nora creates one workflow from a known process version and begins management without blocking the chat request.
3. Nora remains the only persistent agent instance.
4. Required specialists appear only while their assigned task is active.
5. Task and workflow transitions are visible through events and the Office Map.
6. Nora can inspect and safely edit a running workflow without editing code.
7. A stale edit cannot overwrite a newer workflow revision.
8. A recoverable stuck workflow is retried or reassigned within bounded policy.
9. An unsafe or authority-dependent blocker is reported to Carlos with evidence.
10. Authorization approval resumes only the affected work.
11. Every model, tool, timeout, validation, and permission failure is inspectable.
12. Tools correspond to real code functions.
13. Skills correspond to installed `<skill_name>.md` files.
14. Agent configuration is available from the Office Map.
15. Processes, workflows, tasks, attempts, workers, and permissions remain distinct concepts.
16. Backend changes pass `npm run lint` and `npm run check`. A frontend production build is required only when frontend code was changed, or when Carlos explicitly asks for it; a backend-only implementation does not require a frontend build.
17. All implementation code complies with `MANDATORY_CODING_STANDARD.md`.

## 25. Backend File Structure

The backend must preserve the established top-level directory structure. New backend capabilities belong inside the
existing directories that own those responsibilities; they must not be relocated into a new architectural hierarchy
without Carlos's explicit approval.

```text
Back/
├── .env.example
├── package.json
├── server.mjs
├── tools/
│   └── <tool-name>.mjs
├── skills/
│   └── <skill-name>.md
├── ObsidianVault/
│   ├── 10-Knowledge/
│   │   └── <knowledge-files>.md
│   ├── 30-Conversations/                 # Runtime-created and excluded from Git
│   │   └── <filesystem-safe-chat-title>/
│   │       ├── thread.md
│   │       └── files/
│   │           └── <attachments-and-artifacts>
│   └── 90-System/
│       ├── <system-configuration>.md
│       └── Runtime/
│           └── Agents/
│               └── <agent-name>.md
└── src/
    ├── config.mjs
    ├── Router.mjs
    ├── Registry/
    │   ├── SkillRegistry.mjs
    │   └── ToolRegistry.mjs
    ├── providers/
    │   └── <provider-name>Provider.mjs
    └── runtime/
        ├── AgentExecutor.mjs
        ├── ConversationStore.mjs
        ├── EventBus.mjs
        ├── Nora.mjs
        └── RuntimeStore.mjs
```

### 25.1 Configuration ownership

- `Back/src/config.mjs` is the single code-level source for platform configuration, status constants, limits, timeouts,
  model catalog defaults, routing defaults, process catalog defaults, and runtime assembly.
- Platform configuration must not be split into additional configuration modules merely to reduce file size.
- `Back/ObsidianVault/90-System/` stores editable system and agent configuration.
- Each agent configuration must define its default provider and model.
- A task-level model assignment overrides the selected agent's default model only for that task and attempt.
- The resolved provider and model must be copied into the attempt record so execution remains inspectable.
- Credentials and secrets must never be written into Markdown configuration files.

Model selection order is:

1. the model explicitly assigned to the task;
2. the agent's configured default model;
3. a valid platform fallback from `config.mjs` when the preceding configuration cannot be used.

### 25.2 Agent operating-system processes

Every live agent instance must execute as a separate operating-system process.

- The HTTP server, runtime store, event bus, and authorization boundary form the parent control-plane process.
- Nora runs as exactly one persistent child process while the backend is active.
- Every specialist instance runs as its own temporary child process, even when several instances use the same blueprint.
- The parent records each process identifier, instance identifier, blueprint, workflow, task, start time, exit time, and exit
  reason.
- At startup, a child receives a bounded execution envelope containing the assigned agent configuration, workflow and task
  snapshot, resolved model, available skills, allowed tools, granted scopes, timeout, and cancellation channel.
- Child processes communicate with the control plane through a structured inter-process protocol.
- Agent processes may request tool execution, but the parent Tool Registry must validate the request, parameters, scopes,
  timeout, and side-effect policy before execution.
- Agent processes cannot mutate the Runtime Store directly. Nora requests validated runtime commands; specialist workers
  return progress, tool requests, results, and failure evidence.
- Releasing an instance terminates its operating-system process after bounded graceful shutdown.
- Unexpected process exit, unresponsive IPC, forced termination, and non-zero exit codes create runtime error records and
  events that Nora can inspect.
- A cancelled or timed-out task must propagate cancellation to its child process and any active tool or provider request.
- A process must not be reused for an unrelated workflow or task.

### 25.3 Conversation storage

Conversations are private runtime data and must never be committed to Git.

The authoritative location is:

```text
Back/ObsidianVault/30-Conversations/<filesystem-safe-chat-title>/
├── thread.md
└── files/
```

Rules:

- `Back/ObsidianVault/30-Conversations/` remains covered by `.gitignore`.
- One conversation is represented by one folder.
- The folder name follows the current chat title using a filesystem-safe equivalent.
- When the chat title changes, the folder is renamed atomically when possible.
- Duplicate or filesystem-incompatible titles use deterministic disambiguation without changing the title displayed in
  the interface.
- `thread.md` is the authoritative conversation record and preserves a stable conversation identifier independent of
  folder renames.
- `thread.md` records the title, lifecycle state, timestamps, messages, message roles, related workflow identifiers, and
  links to artifacts or attachments.
- Every conversation folder contains a `files/` subfolder, including conversations that do not yet have files.
- Uploaded attachments and generated artifacts belonging to the conversation are saved under its `files/` subfolder.
- Runtime indexes may cache conversation metadata, but the Markdown thread and its files remain the durable source.
- Renaming, archiving, restoring, trashing, and purging a conversation must operate on the corresponding folder without
  leaving orphaned files.
- Chat content must not be stored in source modules, tracked JSON fixtures, Git commits, or repository documentation.

### 25.4 Backend directory responsibilities

- `Back/tools/` contains executable tool modules. The Tool Registry loads tools from this directory.
- `Back/skills/` contains flat Markdown skill descriptors. The Skill Registry loads `<skill-name>.md` files from this
  directory.
- `Back/ObsidianVault/90-System/` contains durable system and agent configuration while runtime-private records remain
  ignored according to `.gitignore`.
- `Back/src/Registry/` contains discovery, validation, and controlled execution for tools and skills.
- `Back/src/providers/` contains model-provider adapters only.
- `Back/src/runtime/` contains the in-memory Workflow Runtime, process lifecycle management, conversations, Nora, events,
  and agent-process execution.
- `Back/src/Router.mjs` maps HTTP requests and responses without becoming the owner of workflow policy.
- `Back/server.mjs` starts and stops the control plane and must terminate Nora and all specialist processes cleanly.

Process definitions and their published versions are durable. Workflow runtimes are in-memory instances of those versions.
The codebase must use `workflow` terminology for the live execution concept; legacy `job` identifiers, filenames,
classes, endpoints, and payload fields must be migrated rather than extended.

## 26. Frontend File Structure

The frontend must preserve its current page-oriented React structure while adopting `Workflow` terminology and the
mandatory stylesheet architecture.

```text
Front/
├── .env.example
├── index.html
├── package.json
├── package-lock.json
├── vite.config.js
└── src/
    ├── main.mjs
    ├── App.jsx
    ├── api.js
    ├── components/
    │   ├── AgentConfigurationForm.jsx
    │   ├── ArtifactPreview.jsx
    │   ├── ChatDialogs.jsx
    │   ├── ChatWorkflowCard.jsx
    │   ├── MarkdownMessage.jsx
    │   ├── Sidebar.jsx
    │   ├── StatusBadge.jsx
    │   └── WorkflowDetailModal.jsx
    ├── hooks/
    │   └── useRuntimeEvents.js
    ├── lib/
    │   ├── artifacts.js
    │   └── officeMapModel.js
    ├── pages/
    │   ├── AuthorizationsPage.jsx
    │   ├── ChatPage.jsx
    │   ├── OfficeMapPage.jsx
    │   ├── OperationsPage.jsx
    │   ├── ProcessesPage.jsx
    │   ├── SettingsPage.jsx
    │   ├── SkillsPage.jsx
    │   └── ToolsPage.jsx
    └── styles/
        ├── main.scss
        ├── config.scss
        ├── themes.scss
        ├── authorizations.scss
        ├── chat.scss
        ├── office-map.scss
        ├── operations.scss
        ├── processes.scss
        ├── settings.scss
        ├── skills.scss
        └── tools.scss
```

### 26.1 Frontend ownership rules

- `main.mjs` mounts the application and imports only `styles/main.scss` for styling.
- `App.jsx` owns application-level page selection, theme selection, and shell state.
- `api.js` owns the normalized backend client and runtime-event URL construction.
- `pages/` contains one module per navigable page. Agent configuration remains in the Office Map; there is no Agents
  page.
- `components/` contains substantial reusable interface units or components that isolate a clearly bounded interaction.
- `hooks/` contains hooks that are genuinely reused or isolate substantial stateful integration.
- `lib/` contains cohesive frontend transformations without backend policy or persistence.
- The frontend never reads or writes the Obsidian Vault directly. It uses backend conversation, file, artifact, workflow,
  agent, and configuration APIs.
- Conversation attachments and artifacts displayed by the frontend resolve to files under the owning conversation's
  `files/` directory through safe backend identifiers.
- Runtime events update displayed state, but the frontend must re-fetch authoritative workflow detail after reconnect,
  conflict, or incomplete event history.

### 26.2 Workflow terminology

- Components, props, state, API mappings, CSS classes, and user-facing labels use `workflow`, not `job`.
- `ChatJobCard.jsx` is renamed to `ChatWorkflowCard.jsx`.
- `JobDetailModal.jsx` is renamed to `WorkflowDetailModal.jsx`.
- Legacy job-named API fields may be read only during a bounded migration and must not be introduced into new code.
- The Processes page manages durable definitions; the Office Map, Chat, Authorizations, and Operations pages display live
  workflows.

### 26.3 Styling structure

- `styles/main.scss` assembles `config.scss`, `themes.scss`, and exactly one stylesheet for each existing page.
- Page and component modules do not import SCSS directly.
- There are no separate component, job-card, workflow-modal, utility, reset, or layout stylesheet partials.
- Styling for workflow cards belongs to `chat.scss`.
- Styling for the workflow-detail modal opened from the Office Map belongs to `office-map.scss`.
- Stylesheet filenames are flat and do not use underscore-prefixed partial names.
- Every stylesheet follows the mobile-first, independent BEM, theme-token, media-query, layout, and overflow rules in
  `MANDATORY_CODING_STANDARD.md`.

## 27. Recreation order

An AI coding agent should recreate the project in this order:

1. Read `MANDATORY_CODING_STANDARD.md` completely.
2. Preserve or recreate the Office Map data contract and interaction model.
3. Define process, workflow, task, attempt, agent, authorization, event, and error schemas.
4. Implement the event bus and in-memory workflow runtime with revision-checked commands.
5. Implement code-native tools and Markdown-native skills.
6. Implement the singleton Nora management loop, validation, recovery, and escalation.
7. Implement temporary worker creation, execution, cancellation, and release.
8. Add provider adapters with timeout and error telemetry.
9. Add the HTTP API and server-sent events.
10. Connect chat, workflow detail, authorizations, Operations, tools, skills, processes, and settings.
11. Validate Office Map compatibility and frontend behavior.
12. Remove any obsolete backend path only after the replacement passes tests.

Do not preserve legacy code merely for compatibility if it violates this functional model. Preserve required user data
and frontend contracts deliberately, but rebuild backend behavior around the domain and authority rules in this
specification.
