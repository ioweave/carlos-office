# Carlos Office — Project Functional Specification

## 1. Purpose

Carlos Office is a private, local-first AI operating environment for one human owner: Carlos.

Carlos is the CEO and final authority. Nora is the single persistent Chief of Staff. Carlos communicates primarily with Nora. Nora interprets intent, answers directly when appropriate, selects or creates Processes and Workflows, and coordinates temporary Agent processes that execute Tasks.

The system optimizes for clarity, local ownership, direct control, and the smallest correct implementation.

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

## 3. Authority model

Carlos is the final authority.

Nora may interpret requests, answer directly, clarify genuinely missing information, select or create Processes/Workflows, select unspecified Task resources, monitor execution, perform safe recovery, and create or improve Tools and Skills when appropriate.

Nora must not approve consequential actions on Carlos's behalf or bypass authorization requirements.

Explicit Carlos configuration is authoritative over Nora's runtime selection.

## 4. Nora

Nora is permanent and unique. She owns conversation interpretation, request routing, Process/Workflow decisions, Task execution-resource selection, monitoring, safe recovery, result summarization, and capability creation.

Nora has one persistent implementation definition containing her core operating instructions and default model selection:

```text
Back/ObsidianVault/System/Nora.md
```

Nora is not stored in or managed through a generic Agent registry.

## 4.1 Knowledge

Knowledge is Carlos's private persistent context layer. It is separate from Nora's implementation definition and contains two documents:

```text
Back/ObsidianVault/Knowledge/Facts.md
Back/ObsidianVault/Knowledge/Instructions.md
```

`Facts.md` stores durable facts, preferences, project context, conventions, and other information Carlos wants available across conversations. `Instructions.md` stores standing user instructions that should guide Nora unless the current explicit request supersedes them.

The Platform loads Knowledge at startup. Current Knowledge is automatically included in every Nora decision and every temporary Agent Task so delegated work does not lose persistent context.

Knowledge is private local data, not a credential store. Passwords, tokens, private keys, and other secrets belong in Credentials. Knowledge is edited manually through Store; Carlos Office does not automatically infer or persist new facts from conversations unless that behavior is explicitly added later.

## 5. Temporary Agents

An Agent is one temporary child process executing one Task.

An Agent has no persistent identity, persona, default model, default Tools, default Skills, or reusable configuration record. At spawn time it receives the Workflow/Task context, resolved input, objective, completion criteria, provider/model, allowed Tools, selected Skills, and current Knowledge.

The process exists only for the Task lifetime. The OS process is the Agent instance. Runtime identity is the generated Agent process ID and PID, not a specialist name such as Dex, Marco, Iris, Luma, or Vera.

## 6. Agent runtime class

The Agent runtime class receives only:

```text
provider
model
tools[]
skills[]
invokeTool()
```

It does not receive an Agent Definition. It constructs Task context, applies current Knowledge and selected Skills, exposes only selected Tools, executes the model/tool loop, and returns the terminal Task result.

## 7. Tasks

A Task is the unit of executable work inside a Process or Workflow.

An executable Task may define:

```text
objective
completion
inputs[]
output
provider + model   optional explicit pair
tools[]            optional explicit set
skills[]           optional explicit set
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

## 8. Task execution selection

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

There is no intermediate specialist-Agent selection step.

## 9. Task Attempts

Each Task execution creates a Task Attempt recording:

- Attempt ID and ordinal;
- Workflow ID and Task ID;
- temporary Agent process ID and PID when available;
- provider/model;
- Tools and Skills;
- resolved input;
- started/ended timestamps;
- status;
- output;
- error or blocked reason;
- related approval ID when blocked.

Attempts are historical execution records. They do not create persistent Agent identities.

## 10. Processes

A Process is a reusable graph definition for work worth repeating. It contains a name, purpose, declared inputs, exactly one start node, exactly one end node, executable Tasks, directed edges, and optional UI layout metadata.

Processes are definitions, not runtime actors. Carlos may edit them manually; Nora may also create or revise them when asked.

## 11. Process graph invariants

A valid Process or ad-hoc Workflow graph must satisfy:

- node types are only `start`, `task`, and `end`;
- exactly one start and one end exist;
- edges are `[fromTaskId, toTaskId]` and reference existing nodes;
- no self-edge or duplicate edge;
- start has no incoming edge and end has no outgoing edge;
- graph is acyclic;
- every node is reachable from start and can reach end;
- explicit Task provider/model are paired;
- Task input/Tool/Skill collections are arrays when explicit.

Legacy persisted `agent` fields may be tolerated while loading old local state, but they have no execution authority and are removed when current code saves the Task or promotes a Workflow.

## 12. Workflows

A Workflow is one execution instance of a Process or an ad-hoc graph. It owns ID, optional Process name, status, inputs, config, start/end IDs, runtime Tasks, edges, and result.

Chat-originated Workflows record:

```text
conversationId
sourceMessageId
```

in Workflow config. This provenance supports Conversation history truncation and Office Map lineage. Scheduled/non-chat Workflows may have no Conversation parent.

## 13. Workflow execution

For each ready Task the platform:

1. resolves provider/model, Tools, and Skills;
2. resolves input from Workflow inputs and upstream outputs;
3. creates a Task Attempt;
4. spawns one temporary Agent child process with current Knowledge;
5. mediates Tool calls and authorization;
6. persists Attempt and Task state;
7. advances dependent Tasks.

Ready independent Tasks may run concurrently. Agents never communicate directly with one another.

## 14. Tools

A Tool performs executable work and defines name, description, input/output contract, executable implementation, optional provider/model metadata, and whether Carlos authorization is required.

Only Tools selected for the current Task are exposed to its Agent process. Nora may create or update Tools when Carlos requests them or when reusable capability is clearly required.

Canonical Tool files live under:

```text
Back/tools/
```

## 15. Skills

A Skill is reusable procedural guidance or context. A Skill is not an Agent persona; it contains methodology that any temporary Agent can apply.

Only Skills selected for the current Task are injected into that Agent execution.

Canonical Skill files live under:

```text
Back/skills/
```

The registries create these directories locally when they are absent.

## 16. Authorizations

Authorization is a cross-cutting authority boundary owned by Carlos. A Tool marked `requiresApproval` cannot execute until Carlos authorizes the exact requested action/input.

Authorization records contain action, requesting temporary Agent process, Workflow/Task/Tool/input context, status, and timestamps.

Approvals are a global interrupt/inbox and may also be resolved contextually from a Workflow inspector.

## 17. Conversations

A Conversation is Carlos's persistent interaction context with Nora. It contains ID, optional title, Nora conversation-model selection, messages, Workflow IDs, and referenced artifacts.

Only Carlos messages are editable. Editing a Carlos message preserves earlier history, replaces that message, removes later messages, cancels/deletes downstream Workflows, removes downstream approvals/artifacts, and replays the edited message through Nora even when the text is identical. Escape is the explicit UI cancel path.

## 18. Artifacts

Artifacts are files associated with a Conversation and may be referenced by messages or Workflows. Editing Conversation history removes downstream artifacts no longer retained by earlier messages.

Carlos Office imposes no artificial backend request/upload-size limit.

## 19. Schedules

A Schedule triggers a reusable Process using either a one-time `at` timestamp or recurring five-field cron expression evaluated in UTC.

A Schedule stores ID, Process, enabled state, timing, Process inputs, Workflow config, last run, and next run. Scheduled Workflows have no Conversation parent unless provenance is explicitly supplied.

## 20. Office Map

Office Map is the live topology and contextual operational-control surface.

Canonical topology:

```text
Nora
 ├─ Conversation
 │    ├─ Workflow
 │    │    ├─ temporary Agent process
 │    │    └─ temporary Agent process
 │    └─ Workflow
 ├─ Conversation
 └─ scheduled / non-chat Workflow
      └─ temporary Agent process
```

Rules:

- Nora is the single permanent central AI node;
- Conversations branch from Nora;
- chat-originated Workflows branch from their Conversation;
- scheduled/non-chat Workflows branch directly from Nora;
- temporary Agent processes branch from their Workflow and disappear when their OS process terminates;
- Process definitions, Tools, Skills, and static specialist Agent blueprints are not topology nodes.

Office Map may provide contextual navigation, authorization resolution, and operational control. It does not configure static Agent defaults because those defaults do not exist.

## 21. Chat surface

Chat is the Carlos ↔ Nora command surface. It manages Conversations, messages, attachments, Conversation model selection, message editing/replay, current-work cancellation where supported, related Workflow navigation, and artifacts.

Chat is not a Workflow designer.

## 22. Processes surface

Processes is the reusable-work design surface. It includes the Process library, graph editor, persisted node layout, Task configuration, explicit-or-Nora-selected models, multiple Tools, multiple Skills, and Schedules.

A Task inspector must not expose a static Agent selector.

## 23. Operations surface

Operations is the Workflow execution inspection/control surface. It exposes runtime graph state, Task states, Task Attempts, temporary Agent process IDs/PIDs, provider/model, Tools, Skills, outputs/errors, events, authorization state, and valid execution controls.

Operations inspects actual runtime Agent processes and Attempt history, not specialist Agent blueprints.

## 24. Capabilities surface

Capabilities manages what temporary Agents can know and do. It contains exactly two durable capability classes:

- Tools — executable abilities;
- Skills — reusable methodology/context.

Persistent specialist Agents are not a capability class. Nora may autonomously create/install Tools and Skills unless Carlos changes that authority rule.

## 24.1 Store surface

Store owns local configuration and persistent user context. It contains:

- **Credentials** — protected authentication material and policies; secret values are not placed in model context;
- **Workspace Variables** — non-secret named values that Tasks may read when needed;
- **Knowledge** — private Facts and Standing Instructions automatically included in Nora decisions and temporary Agent execution context.

Knowledge is not a Capability because it is persistent owner context rather than optional Task methodology.

## 25. Canonical repository structure

```text
Back/
  platform.mjs
  tools/                    executable Tool files
  skills/                   Markdown Skill files
  src/
    Router.mjs
    config.mjs
    controllers/
      ArtifactController.mjs
      AuthorizationController.mjs
      ConversationController.mjs
      EventController.mjs
      KnowledgeController.mjs
      NoraController.mjs
      ProcessController.mjs
      ScheduleController.mjs
    providers/
      OllamaProvider.mjs
    registry/
      Nora.mjs
      Skills.mjs
      Tools.mjs
    runtime/
      Agent.mjs             generic Task executor class
      AgentProcess.mjs      temporary Agent child entrypoint
      AgentProcesses.mjs    temporary OS-process lifecycle
      NoraProcess.mjs       permanent Nora child lifecycle
      nora.mjs              Nora child entrypoint
    services/
      KnowledgeService.mjs
      NoraCreationService.mjs
      ProcessEngine.mjs
      VaultMaintenanceService.mjs
      WorkflowGraphService.mjs
      WorkflowRecoveryService.mjs
  ObsidianVault/
    Conversations/
    Knowledge/
      Facts.md
      Instructions.md
    System/
      Nora.md
      Processes/
      Workflows/
      Schedules/
      Events/
      Runtime/

Front/
  src/
    App.jsx
    api.js
    components/
    lib/
    pages/
    styles/
```

There is no canonical specialist-Agent definition directory. Numeric vault prefixes are not canonical and are migrated away during Platform startup.

## 26. Persistence and implementation constraints

Carlos Office is local-first. Durable product state is stored in the existing local files/vault, with Credentials and Workspace Variables stored in the local SQLite store. Runtime child-process state exists only while the process is alive; durable execution facts belong in Workflow Attempts/events. User Knowledge belongs in the private `ObsidianVault/Knowledge` documents and is loaded into runtime context rather than copied into Conversation files.

Timestamps are stored in UTC and localized only in the frontend.

Implementation constraints:

- backend uses pure ESM `.mjs` modules;
- frontend uses React JSX/JS;
- layout uses Flexbox, not CSS Grid;
- no distributed orchestration layer or event-sourcing architecture;
- no generic multi-user SaaS machinery;
- no dependency-injection framework;
- no generic Agent registry or specialist blueprint framework;
- no default model inheritance through specialist Agents;
- no direct Agent-to-Agent communication;
- no unnecessary abstraction added for hypothetical future use;
- automated tests are added only when Carlos explicitly requests them.

When complexity is optional, delete it. Preserve only complexity inherent to the product behavior.
