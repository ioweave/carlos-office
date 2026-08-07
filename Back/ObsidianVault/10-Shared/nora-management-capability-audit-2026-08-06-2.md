---
id: "3b40af70-8177-4c6a-a6db-6144c642e525"
title: "Nora management-capability audit (2026-08-06)"
scope: "shared"
agent: "Nora"
tags: ["audit","management","governance","permissions","carlos-office","2026-08-06","source-of-truth"]
source: "Live repository inspection 2026-08-06 against C:\\P\\Carlos Office."
created: "2026-08-06T19:54:47.131Z"
updated: "2026-08-06T19:54:47.131Z"
---
# Nora management-capability audit (2026-08-06)

---
title: "Nora management-capability audit (2026-08-06)"
scope: "shared"
agent: "Nora"
tags: ["audit","management","governance","permissions","carlos-office","2026-08-06","source-of-truth"]
source: "Live repository inspection 2026-08-06 against C:\\P\\Carlos Office. Files read live: Back/src/agents/agents.config.mjs, Back/src/lib/toolRegistry.mjs, Back/src/lib/agentRunner.mjs, Back/src/lib/jobRunner.mjs, Back/src/lib/officeStore.mjs, Back/src/lib/projectFiles.mjs, Back/src/lib/runtimeContext.mjs, Back/src/lib/connectivity.mjs, Back/src/controllers/OfficeController.mjs, Back/src/modules.config.mjs, Back/src/Router.mjs, Back/src/mcp/server.mjs, Front/src/pages/AgentsPage.jsx, Front/src/pages/ToolsPage.jsx, Front/src/pages/JobsPage.jsx, Front/src/pages/SettingsPage.jsx, Front/src/pages/OfficeMapPage.jsx, Front/src/pages/MemoryPage.jsx, Front/src/pages/ChatPage.jsx, Front/src/api.js, Front/src/components/Sidebar.jsx."
---

# Nora management-capability audit (2026-08-06)

## 1. Initial runtime verification

### Repository and layout
- **Repository root:** `C:\P\Carlos Office` (confirmed via `Back/src/lib/runtimeContext.mjs:detectLayout` and `Back/src/lib/projectFiles.mjs:DEFAULT_ROOT`).
- **Detected layout:** Front/ + Back/ JavaScript layout (`Back/src/lib/runtimeContext.mjs:detectLayout`).
- **Configured provider:** `ollama` (default in `Back/src/agents/agents.config.mjs:defaultAgentConfig`).
- **Primary model (env-driven):** `minimax-m3:cloud` when `OLLAMA_MODEL` is unset or `qwen3:8b`; else `OLLAMA_MODEL` (`agents.config.mjs:defaultAgentConfig`).
- **Offline fallback model:** `process.env.OLLAMA_FALLBACK_MODEL || 'qwen3:8b'` (`agents.config.mjs`).
- **Temperatures (defaults, can be overridden per agent via API):** luma 0.6, vera 0.1, others 0.2.
- **Max tool rounds:** vera 2, others 4. Hard cap of 12 in `OfficeController.updateAgent`.

### Toolset currently supplied to Nora in this conversation
Live tool definitions in the runtime manifest (filtered through `Back/src/lib/toolRegistry.mjs:listTools('nora')`):

| Tool | Type | Notes |
|---|---|---|
| `memory_search` | read-only vault | all agents |
| `memory_read` | read-only vault | all agents |
| `memory_list` | read-only vault | all agents |
| `memory_write` | mutating vault | creates/append/replaces Markdown in Obsidian; scope `shared`, `agent`, `inbox` |
| `web_search` | read-only external | public web |
| `fetch_url` | read-only external | public HTTP/HTTPS, private-network URLs blocked |
| `project_list_files` | read-only repo | blocks `.git`, `node_modules`, `dist`, `build`, `coverage`, `.env` |
| `project_read_file` | read-only repo | text extensions only, max 100,000 chars |
| `project_search_files` | read-only repo | substring search |
| `current_time` | read-only | IANA timezone |
| `list_ollama_models` | read-only | GET `/api/tags` |
| `list_agents` | read-only | merges `agentDefinitions` + per-agent Markdown overrides |
| `create_agent_job` | mutating | worker → Vera QC loop |
| `get_agent_job` | read-only | returns full job incl. messages + attempts |
| `list_agent_jobs` | read-only | recent jobs |
| `retry_agent_job` | mutating | bumps `maxIterations` by up to +2 and re-enqueues |

Tools that are read-only for Nora: every `*_search`, `*_read`, `*_list`, `current_time`, `list_*`, `get_*`, and `project_*`.

Tools that mutate persistent state for Nora: `memory_write`, `create_agent_job`, `retry_agent_job`.

Tools missing from this conversation that exist only as source-code changes: agent creation/deletion, tool registration, source editing, git, deployment, secrets management, job cancellation/pause, conversation delete.

Actions that require Carlos's explicit approval (per `Back/src/agents/agents.config.mjs:sharedRules`):
- publish, spend money, send messages, deploy, delete data, change credentials.

Capabilities implemented only through source-code changes (not available to Nora at runtime):
- new agent, new tool, agent clone/archive/restore, role/instructions edit, job cancel/pause/reassign, memory delete/archive, git operations, deployment, file-system edits outside the vault, RBAC, secrets management.

## 2. Capability matrix

Status key: `I-direct` = Implemented and directly available to Nora this turn; `I-tool` = Implemented through an existing tool/API; `I-ui-no-nora` = Implemented in UI/API but not available to Nora; `Code-only` = Possible only through source-code modification; `Partial` = Partially implemented; `None` = Not implemented; `Unverified` = Live check failed.

### Agent lifecycle

| Capability | Status | How it works | Evidence | Approval | Risk | Missing control |
|---|---|---|---|---|---|---|
| List all agents | I-tool | `GET /api/agents` or `list_agents` tool | `Back/src/modules.config.mjs`, `Back/src/lib/toolRegistry.mjs` | No | None | — |
| Inspect identity, role, instructions, model, provider, temperature, tool access, fallback, enabled | Partial | List returns provider/model/fallback/temperature/maxToolRounds/enabled; **role and system instructions are not returned** | `Back/src/lib/officeStore.mjs:agentConfig`, `Back/src/controllers/OfficeController.mjs:listAgents` | No | Role/instructions drift invisible | Expose `role` and full `system` from agent Markdown |
| Update runtime config | I-tool | `PUT /api/agents/{agentId}` accepts provider, model, baseUrl, temperature, maxToolRounds, enabled, fallback | `OfficeController.updateAgent`, `Back/src/modules.config.mjs`, `Front/src/pages/AgentsPage.jsx:AgentEditor.save` | Carlos | Wrong model on a critical agent | Confirmation prompt for primary model change |
| Enable/disable agent | I-tool | `enabled` toggle persists to `90-System/Runtime/Agents/<Name>.md` | `officeStore.saveAgentConfig`, `agentRunner.runAgentUnlocked` checks `config.enabled` | No | Disabled agent silently dropped | Display disabled state in UI explicitly |
| Change primary model | I-tool | As above | `OfficeController.updateAgent` | Carlos | Same as above | Same |
| Change fallback model | I-tool | As above | Same | Carlos | Same | Same |
| Change role or system instructions | None | `allowedConfigFields` excludes `name`, `role`, `system` | `OfficeController.updateAgent` | n/a | Stale role/system | Source change only |
| Create a new agent | Code-only | `agentDefinitions` is a literal in `agents.config.mjs` | `agents.config.mjs:agentDefinitions` | Carlos | Adding unvetted agents | Backend schema for dynamic creation |
| Clone agent | Code-only | Same | Same | n/a | n/a | n/a |
| Rename agent | Code-only | Same | Same | n/a | n/a | n/a |
| Delete or archive agent | Code-only | No code path | — | n/a | n/a | n/a |
| Restore agent | Code-only | Same | Same | n/a | n/a | n/a |
| Assign agent-specific memory | Partial | `memory_write` with `scope: agent`; inbox routing for non-Nora writers | `toolRegistry.mjs:memory_write`, `Back/src/lib/memoryWrite.mjs` | No | Workers polluting shared scope | Per-agent memory isolation audit |
| Assign or revoke tools | Code-only | `toolDefinitions[].allowedAgents` is hard-coded | `toolRegistry.mjs` | n/a | n/a | Per-agent allowlist runtime API |
| Define which agents may delegate | Code-only | `create_agent_job.assignedAgent` enum hard-coded to `['marco','luma','dex']` | `toolRegistry.mjs:create_agent_job.inputSchema` | n/a | n/a | n/a |
| Define which agents may approve work | Code-only | Only Vera QC + Nora → Carlos approval are defined; no agent-to-agent approval | `jobRunner.mjs`, `agents.config.mjs:vera.system` | n/a | n/a | n/a |
| Assign agent to a job | I-tool | Set at `create_agent_job` time | `toolRegistry.mjs` | Carlos | Stuck worker | Reassignment API |
| Monitor agent status (idle/queued/working/reviewing/failed/offline) | I-tool | `jobRunnerStatus()`, `office-map`, `/api/health` | `jobRunner.mjs:jobRunnerStatus`, `OfficeController.officeMap`, `OfficeController.health` | No | Stale data if poll stops | Push-based updates |

### Tool lifecycle

| Capability | Status | How it works | Evidence | Approval | Risk | Missing control |
|---|---|---|---|---|---|---|
| List every registered tool | I-tool | `GET /api/tools?agentId=nora` | `OfficeController.listTools`, `toolRegistry.mjs` | No | None | — |
| Inspect description + input schema | I-tool | `listTools` strips `execute` and returns `description + inputSchema` | `toolRegistry.mjs:listTools` | No | None | — |
| Identify which agents can access a tool | I-tool | `allowedAgents` field in `listTools` output | Same | No | None | — |
| Invoke a tool | I-tool | `POST /api/tools/{toolName}` | `OfficeController.invokeTool`, `toolRegistry.mjs:executeTool` | Tool-dependent | Tool misuse | Approval gate for destructive tools |
| Grant tool to an agent | Code-only | Hard-coded | `toolRegistry.mjs` | n/a | n/a | Dynamic allowlist |
| Revoke tool from an agent | Code-only | Same | Same | n/a | n/a | Same |
| Create a new tool | Code-only | `toolDefinitions` literal | `toolRegistry.mjs` | n/a | n/a | Backend plugin loader |
| Update schema or implementation | Code-only | Same | Same | n/a | n/a | n/a |
| Disable globally | Code-only | Same | Same | n/a | n/a | n/a |
| Delete a tool | Code-only | Same | Same | n/a | n/a | n/a |
| Test a tool safely | Partial | `Front/src/pages/ToolsPage.jsx` console for `nora` agent; no sandboxing | `ToolsPage.jsx` | No | Unintended side effects | Side-effect classification per tool |
| Inspect tool failures | I-tool | Tool execution returns `{error}`; `agentRunner.mjs` records `failed: true`; jobRunner logs `console.error` | `agentRunner.mjs` tool loop, `jobRunner.mjs` | No | None | Per-tool failure rate telemetry |
| Audit historical tool calls | Partial | Tool calls per agent iteration are in `toolEvents`; persisted with conversation and job Markdown | `officeStore.mjs:conversationMarkdown`, `jobMarkdown` | No | History grows unbounded | Retention policy + audit view |
| Distinguish read-only vs side-effecting | Partial | Documented in description; `project_*` declared read-only in registry; no runtime check | `toolRegistry.mjs` | No | Side effects possible on any allowed tool | Side-effect flag in schema |
| Require approval before high-impact tools | None | Only prompt-level rule in `sharedRules` | `agents.config.mjs` | n/a | Prompt bypass possible | Backend gate + UI dialog |
| Rate limits / quotas / execution limits | Partial | Hard caps in `create_agent_job.maxIterations ≤ 8`; per-call `min/max` in schemas | `toolRegistry.mjs`, `officeStore.mjs:job` | No | Runaway loops | Concurrency caps and cost budgets |
| Create scoped filesystem, GitHub, browser, email, calendar, deployment, messaging tools | Code-only | None defined | — | n/a | n/a | n/a |

### Access control and authority

| Capability | Status | Where enforced | Evidence |
|---|---|---|---|
| Per-agent tool allowlist | I-direct | Hard-coded `allowedAgents` per tool | `toolRegistry.mjs` |
| Per-tool agent allowlist | I-direct | Same | Same |
| Role-based access control | None | n/a | — |
| Read/write/execute distinction | Partial | `project_*` declared read-only; no other distinctions | `toolRegistry.mjs` |
| Repository path restrictions | I-direct | `safeProjectPath` blocks `.git`, `node_modules`, `dist`, `build`, `coverage`, `.env*`; extension allowlist | `projectFiles.mjs` |
| Vault-folder restrictions | I-direct | `assertVaultPath` ensures absolute path stays inside vault root; per-writer `safeFilename`, `safeId` regex | `officeStore.mjs` |
| Approval gates | None in code | Only the prompt-level shared rule | `agents.config.mjs:sharedRules` |
| Destructive-action protection | Partial | `awaiting_approval` status set after `maxIterations` so Vera never auto-approves past the loop; per-job hard iteration cap | `jobRunner.mjs` |
| User-level permissions | None (single-user local) | n/a | — |
| Secrets isolation | Partial | No secrets persisted in vault; `SettingsPage.jsx` documents env-only keys | `SettingsPage.jsx` |
| Network-access restrictions | I-direct | `fetchUrl.mjs` rejects private-network addresses; Ollama hits only `process.env.OLLAMA_BASE_URL` | `fetchUrl.mjs`, `agents.config.mjs` |
| External-service authorization | None | n/a | — |
| Audit logs | Partial | Job Markdown files (`40-Jobs/*.md`), conversation Markdown files, `toolEvents`, console logs | `officeStore.mjs` |
| Access revocation | Code-only | Allowed agent lists are hard-coded | `toolRegistry.mjs` |
| Temporary permissions | None | n/a | — |
| Permission expiry | None | n/a | — |
| Environment-based restrictions | Partial | `process.env.OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_FALLBACK_MODEL`, `PROJECT_ROOT`, `MAX_ATTACHMENT_BYTES`, `MAX_ATTACHMENTS_TOTAL_BYTES`, `MAX_TEXT_ATTACHMENT_CHARS` | `agents.config.mjs`, `officeStore.mjs`, `projectFiles.mjs` |
| Local-only enforcement | I-direct | Backend binds to `127.0.0.1` per `SettingsPage.jsx`; no DB; storage = Obsidian Markdown | `SettingsPage.jsx`, `OfficeController.health` |

Note: anywhere the rules rely on the prompt in `sharedRules` instead of code, the protection is advisory only and can be bypassed by a misbehaving model or user prompt.

### Delegation and work management

| Capability | Status | Evidence |
|---|---|---|
| Create jobs | I-tool | `create_agent_job` |
| Choose worker | I-tool | `assignedAgent` enum `['marco','luma','dex']` |
| Define expected results + acceptance criteria | I-tool | `expectedResult`, `acceptanceCriteria` |
| Set priority | I-tool | `priority` enum |
| Set iteration limits | I-tool | `maxIterations` (1–8) |
| Start or queue jobs | I-tool | `autoRun: true` enqueues immediately |
| Inspect current job state | I-tool | `get_agent_job`, `list_agent_jobs`, `/api/jobs`, `/api/office-map` |
| Inspect messages between agents | I-tool | `get_agent_job.messages[]` |
| Inspect worker output + Vera review | I-tool | `get_agent_job.attempts[]` |
| Continue failed/unaccepted jobs | I-tool | `retry_agent_job` (`+2` iterations max, hard cap 8) |
| Cancel a queued job | Code-only | No API; `enqueueJob` skips if already scheduled |
| Pause a running job | None | n/a |
| Reassign a job | None | `assignedAgent` is fixed at creation |
| Modify requirements after creation | Code-only | Not in API surface |
| Archive or delete a job | Code-only | `officeStore.updateJob` is the only mutator; no archive/delete route |
| Prevent duplicate jobs | I-direct | `enqueueJob` returns `alreadyScheduled: true` |
| Job dependencies | None | n/a |
| Sequential or parallel workflows | None | n/a |
| Enforce deadlines | None | n/a |
| Notify Carlos when intervention required | Partial | Job reaches `awaiting_approval` after `maxIterations`; UI shows Continue button. No proactive notification channel. |

### Vera quality control

| Capability | Status | Evidence |
|---|---|---|
| Require Vera for every delegated job | I-direct | `qcAgent: 'vera'` in `officeStore.job`; `runJobLoop` always calls Vera after each worker turn |
| Bypass Vera | None | Hard-coded loop |
| Change the QC agent | Code-only | `qcAgent` literal |
| Change QC criteria | Code-only | Criteria are job-specific input; Vera's system instructions are hard-coded |
| Inspect Vera's complete reasoning record | I-tool | `attempts[].qcSummary`, `qcFeedback`, `missing`, `qcModel` |
| Enforce structured verdicts | I-direct | `jobRunner.parseReview` extracts JSON; non-JSON → `revise` with feedback |
| Cap revision loops | I-direct | `maxIterations` (1–8), `retryJob` adds ≤ +2 |
| Continue after cap | I-tool | `retry_agent_job` |
| Detect contradictory/impossible criteria | None | Not implemented |
| Escalate unresolved work to Carlos | Partial | `awaiting_approval` status is the only signal |
| Prevent Vera from introducing subjective scope | I-direct | Vera's system instructions explicitly forbid optional polish churn |
| Audit accepted work later | I-tool | Job Markdown file is persistent and immutable per write (atomic rename) |

### Models and providers

| Capability | Status | Evidence |
|---|---|---|
| Inspect installed Ollama models | I-tool | `list_ollama_models`, `GET /api/models?provider=ollama` |
| Choose an agent's primary model | I-tool | `PUT /api/agents/{agentId}` with `model` field |
| Choose offline fallback | I-tool | Same with `fallback.model` |
| Different models per agent | I-tool | Same |
| Change temperature | I-tool | Same |
| Change maximum tool rounds | I-tool | Same (clamped 0–12) |
| Enable or disable cloud fallback | I-tool | `fallback.enabled` toggle |
| Distinguish connectivity vs auth/quota/config failures | I-direct | `connectivity.mjs:isConnectivityFailure` |
| Monitor which model answered | I-tool | `assistantMessage.model`, `attempts[].workerModel`, `qcModel` |
| Enforce local-only for selected agents | Partial | Set provider/model to local Ollama via API; no hard local-only flag |
| Test model availability before assigning | Partial | `list_ollama_models` lists available names; `AgentsPage` shows only installed models in select dropdown |
| Manage provider credentials safely | Code-only | No vault-side credential storage; env-only |

### Memory and knowledge governance

| Capability | Status | Evidence |
|---|---|---|
| Search permanent memory | I-tool | `memory_search` |
| Read notes | I-tool | `memory_read` |
| Create notes | I-tool | `memory_write` mode=`create` |
| Append to notes | I-tool | mode=`append` |
| Replace notes | I-tool | mode=`replace` |
| Delete notes | Code-only | No API; no delete route |
| Archive stale notes | Code-only | No schema or route |
| Correct false notes | Code-only | Only by `replace` if path is known |
| Mark notes as superseded | Code-only | No `supersedes` / `status` frontmatter fields; tags are free-form |
| Separate shared and agent-specific | I-tool | `scope: shared | agent | inbox` |
| Review worker memory proposals | I-tool | Workers routing to `scope: inbox`; Nora can read with `memory_read`/`memory_list(folder='90-System/Inbox')` |
| Prevent unverified claims from becoming authoritative | None | Tags are free-form; no authority levels |
| Detect contradictions | None | n/a |
| Identify stale implementation records | Code-only | No automated staleness detection |
| Maintain an authoritative architecture note | Code-only | Nora can curate manually only |
| Track provenance and source confidence | Partial | `source` string field; no confidence schema |

### Conversations and files

| Capability | Status | Evidence |
|---|---|---|
| Create conversations | I-direct | `POST /api/chat` creates UUID if absent |
| Reopen them | I-direct | `GET /api/conversations/{id}` rehydrates from Markdown |
| Append messages | I-direct | Same handler appends user + assistant turn |
| Rename them | I-tool | `PUT /api/conversations/{id}` with `title` |
| Delete them | I-tool | `DELETE /api/conversations/{id}` removes Markdown + attachment folder |
| Retrieve attachments | I-direct | `GET /api/conversations/{id}/attachments/{attachmentId}` returns base64 |
| Store attachments | I-direct | `POST /api/chat` with `attachments[]`; written as binary under `30-Conversations/Attachments/<id>/<uuid>-<safe-name>` |
| Reason over text attachments | I-direct | `hydrateConversationMessages` injects ≤ `MAX_TEXT_ATTACHMENT_CHARS` into the model input |
| Reason over image attachments | I-direct | Same passes `image_url` parts; warns if fallback is text-only |
| Distinguish unsupported binary attachments | I-direct | Same emits a placeholder string for non-text, non-image MIME |
| Control attachment size limits | I-direct | `MAX_ATTACHMENT_BYTES` (default 8 MiB), `MAX_ATTACHMENTS_TOTAL_BYTES` (default 20 MiB) |
| Recover from failed model requests | I-direct | `OfficeController.chat` writes an `error: true` assistant turn and returns 500 with the same conversation id |
| Search across conversations | None | No full-text search API |
| Summarize old conversations | None | No API |
| Connect a conversation to a job | None | No link field |
| Transfer a conversation to another agent | Partial | Reject if `conversation.agentId` differs at chat time (returns 409) |
| Export a conversation | None | n/a |
| Archive instead of delete | None | n/a |

Storage confirmation: each conversation is a separate `.md` file at `30-Conversations/Threads/{conversationId}.md` (`officeStore.conversationFile`).

### Monitoring and operational control

| Capability | Status | Evidence |
|---|---|---|
| Backend health | I-tool | `GET /api/health` |
| Ollama connectivity | I-tool | Same |
| Model availability | I-tool | `GET /api/models?provider=ollama`, `list_ollama_models` |
| Active jobs | I-tool | `jobRunnerStatus.active`; `office-map` polls every 4 s |
| Queued jobs | I-tool | `jobRunnerStatus.queued` |
| Active agents | I-tool | `office-map` agent cards |
| Current job stage | I-tool | `active[].stage ∈ {working, reviewing, accepted}` |
| Job iteration | I-tool | `currentIteration/maxIterations` |
| Vera review state | I-tool | `qcVerdict`, `qcScore`, `attempts[]` |
| Conversation/attachment counts | I-tool | `OfficeController.listConversations` |
| Tool failures | I-tool | `toolEvents[].failed`, console logs |
| Model failures | I-tool | `assistantMessage.error`, `jobRunner.lastError` |
| Fallback use | I-tool | `assistantMessage.model.fallbackUsed`, `attempts[].workerModel.fallbackUsed` |
| Stale or interrupted jobs | I-tool | `resumePendingJobs` re-enqueues `queued|running|qc_review` on backend restart |
| Backend restarts | None | No event log |
| Repository layout/root | I-tool | `runtimeContext.getRuntimeDiagnostics` |

Operational control:

| Capability | Status | Evidence |
|---|---|---|
| Pause work | None | n/a |
| Cancel work | Code-only | n/a |
| Restart failed work | I-tool | `retry_agent_job`, `POST /api/jobs/{jobId}/run` |
| Reassign work | Code-only | n/a |
| Change priorities | Code-only | No API |
| Resolve deadlocks | None | Single worker queue (`agentQueue`, `queueTail`) |
| Limit concurrency | I-direct | Serial worker queue in `agentRunner` and `jobRunner` |
| Cost or token budgets | None | n/a |
| Stop runaway loops | Partial | `maxIterations`, `retryJob` cap, `providerSupportsTools` gate |
| Notify Carlos of operational incidents | None | No notification channel |

### Self-improvement and system evolution

| Capability | Status | Evidence |
|---|---|---|
| Inspect source | I-direct | `project_list_files`, `project_read_file`, `project_search_files` |
| Identify defects | I-direct | Read + search |
| Research better approaches | I-direct | `web_search`, `fetch_url` |
| Create implementation plans | I-tool | `create_agent_job` with `assignedAgent: 'dex'` |
| Delegate planning to Dex | I-tool | Same |
| Have Vera validate plans | I-tool | Same loop applies |
| Directly edit source | Code-only | No write tool |
| Commit changes | None | No git tool |
| Push changes | None | n/a |
| Run tests | Code-only | No test runner tool |
| Deploy changes | None | n/a |
| Roll back changes | None | n/a |
| Modify own instructions | Code-only | System text in `agents.config.mjs` |
| Create new agents/tools without backend update | Code-only | n/a |

## 3. Manager-readiness assessment

| Question | Answer | Explanation |
|---|---|---|
| Can Nora create a new agent without editing source? | No | `agentDefinitions` is a literal; no API to extend it. |
| Can Nora delete or archive an agent? | No | No API; the only mutator is `saveAgentConfig`. |
| Can Nora define or modify agent system instructions from the UI? | No | `updateAgent` allowlist excludes `name`, `role`, `system`. |
| Can Nora grant and revoke tools dynamically? | No | `allowedAgents` is hard-coded in the registry. |
| Can Nora create a new tool dynamically? | No | `toolDefinitions` is a literal. |
| Can Nora define role-based permissions? | No | RBAC not implemented. |
| Can Nora require Carlos's approval for a specific tool? | No | No approval gate in code; only a prompt rule. |
| Can Nora cancel or reassign a running job? | No | No cancel/pause/reassign API. |
| Can Nora delete or archive jobs? | No | Only `updateJob` is implemented. |
| Can Nora correct or supersede stale memory? | No | No `supersedes`/`status` schema, no delete/archive API. |
| Can Nora modify Carlos Office source code herself? | No | Read-only project tools only. |
| Can Nora commit and push changes? | No | No git tool. |
| Can Nora safely act as the complete system administrator today? | No | She can observe, edit runtime config for the 5 fixed agents, write memory, and delegate bounded worker jobs; she cannot add/remove agents or tools, cannot cancel/reassign jobs, cannot manage credentials, and cannot approve destructive actions in code. |
| What Nora can manage autonomously today? | list agents/tools/models/jobs; read full source; write curated memory; create and continue bounded jobs; invoke any tool she is allowed to; refresh Ollama model cache; observe health. |
| What still requires Carlos or a developer? | agent lifecycle beyond enabled flag; tool lifecycle; RBAC; destructive-action gates; job cancel/pause/reassign; memory supersession; secrets management; source edits; deployment. |

## 4. Target management model

Nora should manage the system subject to hard technical guardrails, not prompt conventions. Minimum target:

- Dynamic agent lifecycle: create, clone, update role/system/temperature/tools/fallback, enable/disable, archive, restore. Source of truth in `90-System/Runtime/Agents/<agentId>.md` with frontmatter (`status`, `archivedAt`).
- Dynamic tool registry metadata: register new tool entries in `90-System/Runtime/Registry/tools.json` with `name`, `description`, `inputSchema`, `allowedAgents`, `sideEffects`, `requiresApproval`. Backed by a backend loader, not source edits.
- Hard tool-access policy: per-agent allowlist persisted per agent; runtime rejects calls outside the list.
- Approval gates for destructive or external side effects, implemented in `executeTool`, with a UI dialog from Carlos. Affected tools: any new tool flagged `requiresApproval: true`.
- Job controls: cancel, pause, resume, reassign worker, change priority, archive, delete, dependencies, deadlines.
- Memory governance: `supersedes`, `supersededBy`, `status: draft|active|superseded|archived`, provenance (`source`, `sourceConfidence`), contradiction log. Delete and archive APIs.
- Operational monitoring: pushed updates via SSE on `/api/events`; incident log; cap notifications.
- Immutable audit history: append-only job Markdown files (already atomic) + immutable memory audit log under `90-System/Audit/`.
- Safe source-change delegation: a `code_change_request` tool that produces a plan, requires Vera acceptance, and emits a Diff Proposal that Carlos must approve. Nora never edits source directly.
- Test and validation: every code-change proposal must include a verification command and a rollback command.
- Rollback boundaries: reverts go through the same approval gate.
- Always under Carlos's control: secrets, deployment, git push, money, publishing, destructive deletes.

Constraints preserved: JavaScript only, no MongoDB, Obsidian-only storage, MiniMax M3 primary → Qwen fallback, Vera QC, local-first execution, least privilege.

## 5. Gap analysis

| Gap | Classification | Current limitation | Affected files | Proposed backend change | Proposed frontend change | Proposed Markdown schema change | Security constraint | Acceptance tests | Migration / rollback |
|---|---|---|---|---|---|---|---|---|---|
| Agent create / clone / archive / restore | Critical | `agentDefinitions` literal; no archive status | `Back/src/agents/agents.config.mjs`, `Back/src/lib/officeStore.mjs`, `Back/src/lib/toolRegistry.mjs` | New `agents/<id>.md` writer that emits `status: active|draft|archived`; new routes `POST /api/agents`, `DELETE /api/agents/{id}`, `POST /api/agents/{id}/archive`, `POST /api/agents/{id}/restore`; agent resolution merges registry + Markdown | New Agents page actions; require Carlos approval for create/archive | Add `status`, `archivedAt`, `cloneOf` frontmatter fields | Hard-cap on max agents; require Carlos approval token for create/archive | Add/remove agent through API and confirm runtime; ensure archived agents do not run jobs | Default registry remains the source; new agents written alongside |
| Role and system instruction editing | Critical | Not exposed via API | `OfficeController.updateAgent`, `agentRunner.runAgentUnlocked` | Extend `allowedConfigFields` to include `role`, `system`; re-emit `agentMarkdown` body | Add fields in `AgentEditor` | Add `role` and `system` sections in `90-System/Runtime/Agents/<Name>.md` | Carlos approval required for `system` change | Edit via API and confirm new instructions appear in next agent run | Revert by editing Markdown directly |
| Per-agent dynamic tool allowlist | Critical | Hard-coded `allowedAgents` | `toolRegistry.mjs`, `officeStore.mjs` | Persist `toolsAllow` per agent in Markdown; `listTools` and `executeTool` honor it | Allowlist editor in Agents page | Add `toolsAllow`, `toolsDeny` arrays in agent Markdown | Reject any tool call not in allowlist | Add/remove tool and verify denial | Fallback to registry default |
| New tool registration | Critical | `toolDefinitions` literal | `toolRegistry.mjs` | Plugin loader for `90-System/Runtime/Registry/tools.json`; each entry has `execute` source string, `inputSchema`, `allowedAgents`, `sideEffects` | Tool Registry page | Tools metadata JSON | All new tools default to `requiresApproval: true` | Register tool, invoke, see rejection without approval | Disable via metadata |
| Destructive action approval gate | Critical | No gate | `toolRegistry.mjs:executeTool`, `OfficeController.invokeTool` | Add `requiresApproval` flag; new `POST /api/approvals` and `POST /api/approvals/{id}/grant` routes; integration in `executeTool` | Approval dialog; pending approvals widget | Add `pending-approvals/<id>.md` log | Approval must be human (Carlos) at API level | Trigger high-impact tool, verify it stalls until granted | Allowlist bypass requires Carlos-only token |
| Job cancel / pause / reassign / reprioritize / archive | Critical | No API | `jobRunner.mjs`, `OfficeController` | Add `POST /api/jobs/{id}/cancel`, `POST /api/jobs/{id}/pause`, `POST /api/jobs/{id}/reassign`, `PATCH /api/jobs/{id}`; respect a `cancelled` status throughout | Job detail controls | Add `cancelledAt`, `pausedAt`, `reassignedFrom` in job Markdown | Only Nora or Carlos can cancel; reassign requires Carlos | Cancel running job; verify no further attempts run | Old jobs remain valid; new statuses purely additive |
| Job dependencies and deadlines | Important | Not implemented | `jobRunner.mjs`, `officeStore.mjs` | Add `dependencies[]`, `deadline` to job schema; scheduler refuses to start dependent until prerequisites complete | Dependencies view | Same fields in Markdown | Deadlines trigger Carlos notification | Create dependent jobs; verify order | n/a |
| Memory supersession, archival, deletion | Important | No delete/archive; no schema | `Back/src/lib/memory.mjs`, `memoryWrite.mjs`, `officeStore.mjs` | New `DELETE /api/memory?path=...`; archive route; `supersedes`, `supersededBy`, `status` frontmatter fields | Memory page actions | Add `supersedes`, `supersededBy`, `status`, `confidence` | Archive requires Carlos | Supersede, then verify old note returns `status: superseded` | One-way only by default; restore = Carlos |
| Stale note detection | Important | None | `Back/src/lib/memorySearch.mjs`, `officeStore.mjs` | Tag notes with `verifiedAt`; nightly scan flags notes older than N days that conflict with current `90-System/Carlos Office Memory.md` | Memory page "stale" filter | Add `verifiedAt` frontmatter | None beyond read-only | Mark note stale, see it flagged | Disable scan by env flag |
| Provenance and source confidence | Important | Free-form `source` only | `memoryWrite.mjs` | Add `sourceConfidence: 0–1` enum and required `evidence` array | Memory write UI | Same fields | Notes with confidence < 0.5 cannot target `scope: shared` unless `evidence.length >= 2` | Try low-confidence write, see rejection | Optional |
| Immutable audit history | Important | Job + conversation Markdown are atomic but not centrally indexed | `officeStore.mjs` | New `90-System/Audit/` writer that appends each state transition as an immutable Markdown entry | Audit page | `type: audit-entry` frontmatter | Append-only by convention; write-protected by `assertVaultPath` | Trigger event, confirm entry written | n/a |
| Operational notifications | Important | None | `OfficeController` | New `POST /api/notifications` and SSE stream `/api/events` | Toast and notification center | n/a | Audit-logged | Send test notification, confirm SSE delivery | Disable by env flag |
| Source-change delegation | Critical | No tool | `toolRegistry.mjs` | New `code_change_request` tool that requires Vera acceptance and emits a Diff Proposal; Nora cannot write files | Approval dialog; proposal viewer | `type: code-change-proposal` Markdown | Carlos must approve before any source edit | Propose, accept, reject paths | n/a |
| Local-only enforcement flag | Useful later | None | `agents.config.mjs`, `OfficeController.updateAgent` | `localOnly: boolean` per agent; `agentRunner` rejects if cloud model assigned | Toggle in Agents page | `localOnly` frontmatter | Reject API call if `localOnly: true` and provider is not Ollama | Set local-only and try cloud, see rejection | Default `false` |
| Concurrency / cost caps | Useful later | Single worker queue | `agentRunner.mjs`, `jobRunner.mjs` | Add `concurrentJobs`, `dailyTokenBudget` env vars; runner enforces | Dashboard widget | n/a | n/a | Set cap, exceed it, verify rejection | n/a |

## 6. Capabilities that must remain under Carlos's control

- Changing or removing any agent's `system` instructions.
- Adding, removing, or archiving an agent.
- Adding, removing, or disabling a tool.
- Granting a destructive or external-side-effect tool to an agent.
- Cancelling, pausing, or reassigning jobs that are mid-execution.
- Editing secrets, base URLs, or environment.
- Approving any `code_change_request`.
- Deleting or superseding durable memory marked `critical`.

## 7. What Nora can do autonomously today

- List and inspect agents, tools, jobs, conversations, attachments, memory.
- Update an existing agent's provider, model, baseUrl, temperature, maxToolRounds, enabled flag, and fallback configuration through `PUT /api/agents/{agentId}`.
- Invoke any tool she is allowed to (`memory_write`, `create_agent_job`, `retry_agent_job`, etc.).
- Create and continue bounded Marco/Luma/Dex jobs with explicit acceptance criteria.
- Write curated shared memory and read inbox memory.
- Inspect full repository source code through the read-only project inspector.

## 8. What still requires Carlos or a developer

- Anything in §6 above.
- Source code edits.
- Tool / agent / RBAC schema additions.
- Approval gate plumbing.
- Git, deployment, secrets.
- New persistence backends.

---

This audit is the source of truth for management scope as of 2026-08-06. Companion planning job: see the Dex job created immediately after this note.
