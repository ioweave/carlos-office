# Carlos Office Platform Architecture

## 1. Purpose

Carlos Office models an office with one human owner, a manager, configurable collaborators, reusable processes, durable executions, communication, authorization, tools, skills, and quality control. Its architecture optimizes for visible collaborative work, restart safety, least authority, explicit handovers, and simple JavaScript.

## 2. Canonical domain

```text
Channel thread ──1:1──> Conversation
Conversation ──1:n──> Request
Request ──0:n──> Job
ProcessDefinition ──1:n──> immutable ProcessVersion
ProcessVersion ──1:n──> Job
Job ──1:n──> Task ──1:n──> TaskAttempt
Job ──1:n──> AgentInstance ──n:1──> AgentDefinition
TaskAttempt ──1:n──> ToolActivity ──n:1──> Tool ──n:1──> ToolProvider
Job/Task ──1:n──> Artifact, JobEvent, Assessment, Authorization
```

A process is a definition. A job is one execution. A task is a process step. An AgentInstance is a worker allocation, never a job. “Temporary” may describe execution context or an unpromoted AgentDefinition, but never erases the historical relationship between a completed job and its originating conversation.

## 3. Conversation and context

Chats persist by default and remain untracked by Git. Context and checkpoints are internal implementation details scoped to a Conversation or Job.

Editing an earlier message truncates every later message and cascades to later requests, jobs, attempts, events, artifacts, context, and assessments. Purging removes identifiable records; anonymous aggregate counters may remain only when they cannot be traced to a conversation, job, or artifact. Any purged reference returns 404.

Explicit promoted memories are independent from conversation history. Conversation deletion does not silently preserve its contents as ambient memory.

## 4. Nora intake

Nora answers directly when a request is simple and needs no delegation or consequential side effect. Otherwise she:

1. resolves material ambiguity;
2. selects an exact published process, adapts one privately, or generates a private one-off;
3. performs authorization preflight;
4. starts a Job attached to the originating message;
5. monitors tasks and communicates observable milestones;
6. pauses with a contextual unblock/cancel response when Carlos is needed;
7. assesses the final result and hands it over.

Safe read-only and reversible work may autostart. Writes and risky actions pause unless standing authorization applies.

## 5. Process designer

The editor is an n8n-style directed acyclic graph with exactly one Start and one End. Supported node contracts are:

- Agent Task
- Human Input
- Human Approval
- Condition / Router
- Parallel Fork / Join
- Subprocess
- Delay / Wait
- Handover
- End (exactly one final quality-gated handoff)

An Agent Task prescribes an exact ordered tool plan, including templated arguments and named prior-result bindings. Connections carry typed JSON-schema-compatible input and output contracts. Conditions use a safe structured builder; arbitrary JavaScript is excluded. Retry and rework are bounded. Drafts are mutable; published ProcessVersions are immutable. Running jobs retain their execution binding unless Carlos explicitly restarts or migrates them.

Triggers may originate from chat, manual action, schedule, webhook, or API.

## 6. Agents and concurrency

Each AgentDefinition has a `maxInstances` setting that defaults to one. Every AgentInstance executes one task at a time. Nora may allocate multiple instances of a definition when its limit permits. Queue order is priority then creation time. Parallel branches run concurrently when their agents have capacity; an isolated branch failure pauses its dependants without stopping unrelated branches unless the process opts into fail-fast.

Nora has a lightweight orchestration lane distinct from her worker instances. Delegation is visible as tasks or subprocesses. A temporary specialist inherits a parent definition’s effective tools and permissions and cannot expand them. Carlos approves promotion or privilege expansion.

## 7. Tools, providers, skills, and extensions

A Tool is a typed programmatic function with stable identity/version, provider, input/output schema, side-effect class, scopes, allowed agents, timeout, retry, idempotency, cost, health, and redaction metadata. An MCP server is a ToolProvider whose methods are normalized into named Tools. Agents never receive a generic `mcp_call`.

A Skill is a strategy and set of practices: when to act, which granular tools to use, in what order, quality checks, examples, and recovery guidance. Imported skills may propose tools and process templates, but cannot expand authorization. Nora may draft a tool; Carlos enables it.

Effective tool access is:

```text
Agent grant ∩ process requirement ∩ provider availability ∩ authorization
```

## 8. Models and static configuration

Settings maintains `Provider > Models > abilities/context/settings/enabled`. Credentials are encrypted references and secret values are never returned after save.

Model resolution order:

1. tool-required provider/model;
2. process-step requirement;
3. task capability requirement;
4. agent preference;
5. global default and fallbacks.

Tools inherit provider defaults. A Task may create an ExecutionBinding with specific settings without mutating static configuration.

## 9. Authorization

Authorization is preflight plus just-in-time enforcement. Scope can include provider, tool, action, resource, agent, process, job, time, and usage limit. Grants may be once, for a job, for a process, until a time, or standing. High-risk actions never become silent. Carlos is the only human authority.

HTTP/tool recovery policy:

- 400: correct once, then pause;
- 401: supported credential refresh, then reconnect;
- 403: inspect policy and ask Carlos;
- 429: honor Retry-After, back off, then equivalent allowed provider;
- 5xx/network: back off, retry, then equivalent allowed provider;
- invalid tool output: validate/correct, retry, then pause;
- unknown side-effect result: reconcile before retry.

Nora may propose reusable recovery or skill changes; Carlos approves them.

## 10. Quality and handover

Dimensions are Completeness, Relevance, Correctness, Evidence/provenance, and Format/contract. Aggregate scale is 0–100. Defaults: normal 90, final handover 95, non-critical 80. Process definitions may override.

Contract validation runs first. Nora is the default evaluator; Vera or another evaluator may be configured. A task output assessment becomes the downstream task’s input quality. End owns Nora’s final assessment and Carlos’s separate score, dimensions, comments, and accept/revise/reopen decision.

## 11. UI contracts

Chat shows one evolving card per Job attached to the originating message. Its timeline exposes who, what, when, ordered tool activity, attempts, artifacts, assessments, errors, and result summaries—but never private chain-of-thought. Routine events remain inside the card; milestones, failures, required decisions, and final handover become Nora messages.

Office Map shows only jobs inside the central sphere, durable conversations as small nodes near Nora, permanent AgentDefinitions around the sphere, and active AgentInstances as satellites. Dragging nodes uses the camera-facing 2D plane while preserving 3D coordinates; jobs are constrained to the sphere. The sphere is represented by its unobstructed silhouette, without latitude/longitude grid lines.

Operations reports global/process/job/task/agent/tool/provider/model failure rates, failed attempts versus terminal failures, recovery, queue and execution time, provider health, authorization blocks, quality trends, rework, and Carlos overrides.

## 12. Channels and lifecycle

Chat, Telegram, WhatsApp, email, and future channels implement one adapter contract. One external thread maps to one durable Conversation. Incoming messages become Requests through Nora intake; outbound messages use normal authorization.

Verbose tool events retain for 14 days by default. Redacted job summaries and assessments remain until job deletion. Artifacts remain until explicit deletion or cascade. Anonymous operational aggregates may remain indefinitely. Durations are configurable and cleanup runs hourly.
