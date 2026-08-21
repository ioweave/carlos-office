# Carlos Office — Functional Specification

## 1. Purpose

Carlos Office is a private, local-first AI operating environment for Carlos.

Carlos is the CEO and final authority. Nora is the one permanent Chief of Staff. Carlos primarily communicates with Nora. Nora may answer directly, use an existing Process, create an ad-hoc Workflow, or create reusable Tools, Skills, Processes, and Schedules needed to perform the work.

The implementation must remain deliberately small. Carlos Office is not:

- a multi-user SaaS;
- a distributed workflow engine;
- Kubernetes for Agents;
- an event-sourcing platform;
- a generic enterprise orchestration framework;
- a worker fleet, queueing platform, or microservice system.

The simplest correct implementation is the required implementation.

## 2. Operating model

```text
Carlos
  ↓
Nora process
  ↓
Process / Workflow graph
  ↓
Temporary specialist Agent processes
  ↓
Tools + Skills
  ↓
Result / Artifact
```

Three rules define the runtime:

> Nora thinks. Platform coordinates. Agents work.

> A Process is graph data.

> The Agent process itself is the Agent Instance.

## 3. System processes

Carlos Office has three executable roles.

### 3.1 Platform process

`Back/server.mjs` is the persistent server-like Node process.

The Platform owns infrastructure and authority:

- HTTP/API;
- local file persistence;
- Process definitions and Workflow state;
- graph execution;
- Schedules;
- Conversation and Artifact storage;
- Tool and Skill registries;
- Tool execution;
- Authorizations;
- Event recording;
- spawning and terminating Nora/Agent child processes.

The Platform must not perform LLM reasoning itself.

### 3.2 Nora process

Nora is exactly one persistent Node child process while Carlos Office is running.

Nora owns reasoning and Chief-of-Staff decisions. The Platform communicates with Nora using Node IPC. Nora receives a decision request and returns structured output.

Nora may:

- answer Carlos directly;
- choose an existing Process;
- create an ad-hoc Workflow;
- select unspecified Agent/Tool/Skill/model resources for a Task;
- create or update Tools, Skills, Processes, and Schedules;
- review failed Tasks;
- summarize completed Workflows.

Nora must not:

- create another Nora;
- approve Carlos's Authorization requests;
- report failed work as successful;
- directly execute Platform authority or persistence operations.

### 3.3 Agent process

A specialist Agent Instance is one temporary Node child process created for one Task execution.

The process:

1. receives the Agent Definition, Task, model selection, Skills, and allowed Tool contracts;
2. creates one small generic `Agent` class instance internally;
3. builds Task context;
4. runs the model/Tool loop;
5. requests Tool execution from the Platform over IPC when needed;
6. returns `completed`, `blocked`, or `failed` output;
7. exits.

There is no separate persistent runtime Agent object whose lifecycle duplicates the operating system process lifecycle.

The OS process is the Agent Instance. Its PID is the runtime identity used for observation.

## 4. Agent Definition

An Agent Definition is data, not a subclass and not a running service.

Agent Definitions live under:

```text
Back/ObsidianVault/90-System/Agents/*.md
```

A definition can contain:

- name;
- instructions;
- provider/model defaults;
- default Tool names;
- default Skill names.

All specialists use the same small generic `Agent` execution class unless a demonstrated product requirement requires genuinely different execution semantics.

Agent specializations such as researcher, writer, developer, analyst, or designer should normally differ through data — instructions, model, Tools, and Skills — rather than class inheritance.

Nora also has a definition file, but Nora is not launched as a disposable specialist Agent.

## 5. Agent execution class

The generic Agent class is intentionally small. Its responsibilities are only:

- build model context from the Agent Definition, Task input, and Skills;
- expose the selected Tool contracts to the model;
- call the selected model;
- request allowed Tool execution;
- add Tool results back to model context;
- continue until the Task has a final result or fails.

It does not own:

- Workflow persistence;
- Task status persistence;
- Authorization persistence;
- Agent registries;
- retry/recovery policy;
- Process graph execution;
- long-lived lifecycle state.

Those concerns belong to the Platform.

## 6. Process graph

A Process is a durable reusable directed graph represented as data.

It contains:

- name;
- purpose;
- declared inputs;
- exactly one start node;
- exactly one end node;
- Task nodes;
- directed edges.

The graph is necessary product complexity: start, end, nodes, and edges guide execution and allow fan-out branches and joins.

Graph invariants:

- node types are `start`, `task`, or `end`;
- exactly one start and one end exist;
- every edge references existing nodes;
- start has no incoming edge;
- end has no outgoing edge;
- self-edges and duplicate edges are invalid;
- the graph is acyclic in v1;
- every node is reachable from start;
- every node can reach end.

The Process definition is data. It is not executable orchestration code.

## 7. Workflow

A Workflow is one durable runtime execution of a Process graph or one ad-hoc graph.

A Workflow stores:

- Workflow ID;
- source Process name when applicable;
- status;
- inputs and runtime config;
- copied start/end/Task/edge graph;
- Task Attempt history;
- final result when available.

Workflow state is persisted as local JSON so Operations remains inspectable across Platform restarts.

A separate ProcessVersion system, draft/publish lifecycle, command bus, event-sourcing store, or distributed coordinator is not required.

## 8. Task and Attempt

An executable Task can define:

- objective;
- completion criteria;
- named inputs/output;
- explicit Agent Definition;
- Tool names;
- Skill names;
- provider/model override;
- runtime status;
- ordered Attempt history.

The Platform determines readiness from graph dependencies. Independent ready Tasks may execute in parallel.

Each execution creates an Attempt containing:

- Attempt ID and number;
- Workflow and Task IDs;
- Agent Definition name;
- provider/model;
- resolved input;
- selected Tools and Skills;
- UTC start/end timestamps;
- status;
- output, blocker, or error.

Attempt history remains durable after the Agent process exits.

## 9. Tools

A Tool is an executable `.mjs` module in `Back/tools/`.

A Tool exposes:

- unique name;
- description where useful;
- input contract;
- executable function;
- optional output contract;
- optional `requiresApproval` flag;
- optional Tool-specific provider/model metadata.

Nora may autonomously create or update Tool modules. The Tool registry validates the generated module before making it live.

Specialist Agent processes do not execute Tool source directly. They request Tool invocation over IPC and the Platform executes it. This keeps side effects, Tool availability, and Carlos's authority centralized.

If a Tool declares `requiresApproval`, the exact Workflow/Task/Tool/input action must have a matching approved Authorization before the Platform executes it. The approval is consumed after use.

Tools receive an `AbortSignal` so cooperative Tool work can stop when a Workflow is cancelled.

## 10. Skills

A Skill is reusable Markdown guidance in `Back/skills/`.

Skills provide methodology or operating knowledge. They cannot execute side effects or grant authority.

The full selected Skill content is supplied to the Agent performing the Task. Nora's routing context should use compact Skill summaries rather than loading every full Skill document.

## 11. Authorization

Carlos is the final authority.

An Authorization is durable and contains:

- UUID;
- action;
- actor;
- exact execution context;
- status: `pending`, `approved`, `rejected`, or `consumed`;
- UTC creation/resolution/consumption timestamps.

Authorization history survives Platform restart.

Nora and specialist Agents may request authority but cannot grant it.

## 12. Workflow execution

The Platform Process engine is deliberately direct:

1. load the Workflow graph;
2. stop if it is terminal or blocked;
3. find ready Task nodes;
4. ask Nora only for execution resources the Task did not explicitly define;
5. resolve the Task input from Workflow input and completed upstream Tasks;
6. fork one temporary Agent process per assigned ready Task;
7. run independent ready Tasks in parallel;
8. persist Attempt and Task transitions;
9. let child Agent processes exit when their Task ends;
10. continue until the graph completes, blocks, fails, or is cancelled.

Only one Platform execution promise may own a Workflow at a time. Duplicate run requests join the existing execution rather than dispatching the same Task twice.

If no ready Task exists while an otherwise active Workflow cannot advance, the Platform records a stalled event rather than inventing progress.

## 13. Cancellation

Cancellation must stop actual runtime work, not merely change a status label.

When Carlos cancels a Workflow:

- the Platform terminates active specialist Agent child processes for that Workflow;
- Platform-side Tool AbortSignals are aborted;
- no new Tasks are scheduled;
- running Attempts become cancelled rather than successful;
- non-terminal Task/Workflow state is persisted as cancelled;
- cancellation is recorded durably.

A side effect that already completed cannot be undone and must not be represented otherwise.

## 14. Restart recovery

Carlos Office does not require replay infrastructure or an autonomous recovery Agent.

At Platform startup, persisted Workflows are inspected. If the previous Platform stopped while work was running:

- running Attempts receive a UTC end timestamp and interruption error;
- affected Tasks become blocked;
- the Workflow becomes blocked;
- an interruption record/event is persisted;
- work is not automatically retried.

Carlos may inspect and explicitly resume or restart the Workflow.

## 15. Conversation and Chat

A Conversation is durable communication history between Carlos and Nora. It stores:

- Conversation ID;
- Conversation-specific Nora provider/model selection;
- messages;
- related Workflow IDs;
- related Artifacts.

Changing a Conversation's model changes only that Conversation and its non-terminal Workflows. It does not rewrite Nora's global Agent Definition.

For Workflow requests, Chat flow is:

1. persist Carlos's message;
2. ask Nora to classify the request;
3. create/persist the Workflow;
4. link it to the Conversation;
5. persist Nora's acknowledgement;
6. return the Workflow to Chat promptly;
7. continue Workflow execution asynchronously in the Platform;
8. let the frontend poll the Workflow card;
9. append Nora's final handover or truthful blocker/failure message.

SSE/WebSocket infrastructure is not required for v1; bounded polling is sufficient.

## 16. Artifact

An Artifact is a file related to a Conversation.

Artifact bytes use an ID-based unique backing filename so duplicate human filenames cannot overwrite historical content. The original filename remains metadata.

Text-like request Artifacts are supplied to Nora intake and Workflow inputs. Binary Artifacts remain metadata unless a Tool explicitly reads them.

No additional backend request/upload size limit is a v1 requirement.

## 17. Schedule and time contract

A Schedule starts a Process once or by cron.

All persisted timestamps are UTC ISO-8601 values produced or normalized with `Date#toISOString()`.

Rules:

- one-time Schedule values are stored in UTC;
- cron expressions are evaluated in UTC;
- `lastRunAt` and `nextRunAt` are UTC;
- Events, messages, Artifacts, Attempts, Authorizations, and interruption timestamps are UTC;
- the backend never stores locale-formatted dates;
- the frontend converts local date/time input to UTC before persistence;
- the frontend converts stored UTC timestamps to browser-local time only for display.

## 18. Events

Events are append-only local diagnostics, not an event-sourcing architecture.

They make Workflow transitions, failures, approvals, Tool execution, scheduling, cancellation, and restart interruption inspectable in Operations.

## 19. Product surfaces

Carlos Office has six user-facing surfaces:

1. **Chat** — Carlos's direct channel to Nora.
2. **Office Map** — operational view and Nora/Agent Definition configuration.
3. **Processes** — reusable Process graphs and Schedules.
4. **Operations** — Workflow/Task/Attempt/Event inspection and controls.
5. **Authorizations** — Carlos's authority inbox and durable history.
6. **Capabilities** — installed Tools and Skills.

There is no separate Settings, Tools, Skills, or Agents page.

The Office Map remains the approved spatial operational interface and should not be redesigned as a side effect of runtime work.

## 20. Persistence and privacy

Carlos Office prefers direct local files over database infrastructure.

Private runtime/user data must not be committed to Git, including Conversations, Artifacts, Events, Processes, Workflows, Schedules, Authorization runtime state, credentials, sessions, and caches.

Source-controlled material includes application code, Agent Definitions, Tools, Skills, specifications, and example environment files.

## 21. Validation

Routine validation is:

```bash
cd Back
npm run lint
npm run check

cd ../Front
npm run lint
npm run build
```

CI performs those checks on pushes and pull requests.

Automated tests are added when explicitly required by the project owner or coding standard.

## 22. Non-requirements

Do not introduce these without a demonstrated product need:

- permanent specialist Agent services;
- an in-memory Agent lifecycle model duplicating OS processes;
- Agent class inheritance for configuration differences;
- worker fleets or job queues;
- separate ProcessVersion infrastructure;
- draft/publish/archive machinery merely for architecture completeness;
- generic command buses;
- distributed locks;
- event sourcing;
- SSE/WebSockets when polling is sufficient;
- databases solely to replace local files;
- generic multi-user authentication/RBAC infrastructure;
- containers or remote workers merely to run local specialist Agents.
