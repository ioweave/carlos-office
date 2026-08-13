---
id: "332733f1-09bb-4172-aac3-a2a2f9baf529"
title: "Nora management-capability audit (2026-08-06)"
scope: "shared"
agent: "Nora"
tags: ["audit","management","governance","permissions","carlos-office","2026-08-06","source-of-truth"]
source: "Live repository inspection 2026-08-06. See header for file list and live tool executions."
created: "2026-08-06T17:17:49.366Z"
updated: "2026-08-06T17:17:49.366Z"
---
# Nora management-capability audit (2026-08-06)

---
title: "Nora management-capability audit (2026-08-06)"
scope: "shared"
agent: "Nora"
tags: ["audit","management","governance","permissions","carlos-office","2026-08-06","source-of-truth"]
source: "Live repository inspection 2026-08-06 against C:\\P\\Carlos Office. Files read live: Back/src/agents/agents.config.mjs, Back/src/lib/toolRegistry.mjs, Back/src/lib/agentRunner.mjs, Back/src/lib/jobRunner.mjs, Back/src/lib/officeStore.mjs, Back/src/lib/projectFiles.mjs, Back/src/lib/runtimeContext.mjs, Back/src/lib/memory.mjs, Back/src/controllers/OfficeController.mjs, Back/src/modules.config.mjs, Back/src/Router.mjs, Back/src/mcp/server.mjs, Front/src/pages/AgentsPage.jsx, Front/src/pages/ToolsPage.jsx, Front/src/pages/JobsPage.jsx, Front/src/pages/SettingsPage.jsx, Front/src/pages/OfficeMapPage.jsx. Live tools executed: list_agents, list_ollama_models, current_time, memory_list, memory_search, project_list_files, project_read_file."
supersedes: "Any earlier note claiming Nora can fully administer agents, tools, jobs, memory, or source code at runtime."
created: "2026-08-06T17:15:50Z"
updated: "2026-08-06T17:15:50Z"
---

# Nora management-capability audit (2026-08-06)

> Source of truth: this Markdown file at `90-System/Nora management-capability audit.md`, written after live inspection on 2026-08-06. Anything that contradicts it is stale until re-verified.

## 0. Initial runtime verification

| Item | Live evidence (2026-08-06 17:15 GMT-5) |
|---|---|
| Repository root | `C:\P\Carlos Office` (`Back/src/lib/runtimeContext.mjs:18` `projectRoot = path.resolve(process.env.PROJECT_ROOT || DEFAULT_ROOT)`; live `listProjectFiles` root output). |
| Source layout | `Front/ + Back/ JavaScript layout` (`Back/src/lib/runtimeContext.mjs:24` `if (front && back) return 'Front/ + Back/ JavaScript layout'`). No `apps/` or `apps/api` / `apps/web` folders exist anywhere; prior notes describing `apps/api` and `apps/web` are stale and must be archived. |
| Nora provider | `ollama` via `http://127.0.0.1:11434` (live `list_agents`). |
| Nora primary model | `minimax-m3:cloud` (live `list_agents`; chosen in `Back/src/agents/agents.config.mjs:67-70` `defaultAgentConfig`). |
| Nora fallback | `qwen3:8b` enabled (`Back/src/agents/agents.config.mjs:78-82`). |
| Nora tool cap | `maxToolRounds: 4` (`Back/src/agents/agents.config.mjs:73`; live `list_agents`). |
| Ollama models present | `qwen3:8b`, `qwen3.6:latest`, `tinyrick/gemma-4-31B-it-uncensored-heretic-vision-llmfan46:Q4_K_M`, `Agen/gemma-4-26B-A4B-it-uncensored-heretic:latest`, `gemma4:latest` (live `list_ollama_models`). `minimax-m3:cloud` is a cloud primary and not local. |

### Live tool inventory (this request)

Defined in `Back/src/lib/toolRegistry.mjs:13-279` and surfaced via the runtime manifest. Availability per agent is enforced by `allowedAgents` arrays.

| Tool | Allowed agents (live) | Mutates persistent state? | Read-only? |
|---|---|---|---|
| `memory_search` | all | No | Yes |
| `memory_read` | all | No | Yes |
| `memory_list` | all | No | Yes |
| `memory_write` | all | Yes (vault Markdown) | No |
| `web_search` | all | No | Yes (HTTP only) |
| `fetch_url` | all | No (private network blocked in `Back/src/lib/fetchUrl.mjs`) | Yes |
| `current_time` | all | No | Yes |
| `list_ollama_models` | nora, dex | No | Yes |
| `list_agents` | nora | No | Yes |
| `project_list_files` | nora, dex, vera | No | Yes |
| `project_read_file` | nora, dex, vera | No | Yes |
| `project_search_files` | nora, dex, vera | No | Yes |
| `create_agent_job` | nora | Yes (creates job record + auto-runs worker/Vera loop) | No |
| `get_agent_job` | nora | No | Yes |
| `list_agent_jobs` | nora | No | Yes |
| `retry_agent_job` | nora | Yes (re-enqueues job) | No |

Tool mutates persistent state: yes for `memory_write`, `create_agent_job`, `retry_agent_job`. No tool mutates agents, the source tree, or the filesystem outside the Obsidian vault.

### Actions that already require Carlos's explicit approval today

- Editing any Carlos Office source file (no tool exists; `project_read_file` and friends are read-only — `Back/src/lib/toolRegistry.mjs:135-181` and `Back/src/lib/projectFiles.mjs:62-96`).
- Granting a new agent system prompt or new agent identity (no `create_agent` route exists in `Back/src/modules.config.mjs`; registry of agents is hard-coded in `Back/src/agents/agents.config.mjs:13-78`).
- Adding, removing, or editing tools (no tool-management tool or route exists; tools are hard-coded in `Back/src/lib/toolRegistry.mjs:13-279`).
- Configuring a non-Ollama provider's secret (keys live in backend environment variables; the front-end explicitly says they are never stored in the browser — `Front/src/pages/SettingsPage.jsx`).
- Deleting or restoring agents, jobs, conversations, or memory in bulk (no destructive endpoints; only `DELETE /api/conversations/{conversationId}` exists — `Back/src/modules.config.mjs:14`).

### Capabilities implemented only through source-code changes today

- New agent identities, system prompts, roles, or tool allowlist edits.
- New tool definitions, schema changes, or `allowedAgents` lists.
- Permission model, approval gates, rate limits, quotas.
- New job lifecycle verbs (cancel, pause, reassign, reprioritise).
- Memory archival/supersession semantics, provenance, authority tags.
- Direct source-tree edits, tests, deploys, git operations.
- Carlos-session authentication (none — `Back/src/lib/officeStore.mjs` and `OfficeController` rely on `127.0.0.1` binding only).

---

## 1. Agent lifecycle management

Capabilities listed → classification key: **Dynamic** = via live API/tool, **Configuration-file** = via editable Markdown under `90-System/Runtime/Agents/`, **Code-only** = requires source edit, **Not implemented** = no path.

| Capability | Current status | How it works | Evidence |
|---|---|---|---|
| List all agents | **Implemented and directly available** | `list_agents` tool; `GET /api/agents` route. | `Back/src/lib/toolRegistry.mjs:194-205`; `Back/src/modules.config.mjs:3`. |
| Inspect identity/role/instructions/model/provider/temperature/fallback/enabled | **Implemented and directly available** | `list_agents` returns full record from `90-System/Runtime/Agents/*.md`; runtime identity/system prompt defined in `Back/src/agents/agents.config.mjs:13-78`. | Live `list_agents` output 2026-08-06; `Back/src/agents/agents.config.mjs`. |
| Update existing runtime config | **Implemented and directly available** | `PUT /api/agents/{agentId}` via `OfficeController.updateAgent`, fields restricted to the `allowedConfigFields` list. | `Back/src/controllers/OfficeController.mjs:46-58`; `Back/src/modules.config.mjs:4`. |
| Enable / disable agent | **Implemented and directly available** | Same endpoint; `enabled` field in `allowedConfigFields`. | `Back/src/controllers/OfficeController.mjs:11-14,46-58`. |
| Change primary or fallback model | **Implemented and directly available** | `model`, `fallback.model`, `fallback.enabled`, `fallback.provider`, `fallback.baseUrl` all in `allowedConfigFields`. | `Back/src/controllers/OfficeController.mjs:11-14`. |
| Change role or system instructions | **Partially implemented** | Markdown files under `90-System/Runtime/Agents/*.md` contain the rendered role text, but the *system prompt* that is actually sent to the model is constructed from `agentDefinitions[agentId].system` in `Back/src/agents/agents.config.mjs:13-78` — a hard-coded constant. The UI shows `agent.role` (display only) but does not let Nora edit the model prompt itself. | `Back/src/agents/agents.config.mjs:13-78`; `Front/src/pages/AgentsPage.jsx:16-149`. |
| Create a new agent | **Possible only through source-code modification** | No route, tool, or method exists to append to `agentDefinitions`. | `Back/src/modules.config.mjs` has no `POST /api/agents`; `Back/src/agents/agents.config.mjs` is a static export. |
| Clone an agent | **Possible only through source-code modification** | Same as above. | — |
| Rename an agent | **Partially implemented** | Display name can be edited via `name` field in markdown frontmatter (via `agentMarkdown`/`parseFrontmatter`), but the file path, the `'agentId'` key, and the registry key are immutable. The model prompt line `"You are Marco, …"` would not change. | `Back/src/lib/officeStore.mjs:118-168` vs. `Back/src/agents/agents.config.mjs`. |
| Delete an agent | **Not implemented** | No route; `Back/src/modules.config.mjs` exposes nothing for delete. | — |
| Archive an agent | **Not implemented** | No `archived` flag in `agentConfig` shape; only `enabled`. | `Back/src/lib/officeStore.mjs:106-132`. |
| Restore an archived agent | **Not implemented** | Same. | — |
| Assign agent-specific memory | **Implemented in UI/API but not available to Nora** | `buildMemoryContext` (live-loaded) augments prompts with vault memory based on `agentId`, but the curator is Nora and there is no per-agent scope UI. | `Back/src/lib/memory.mjs`, `Back/src/lib/memorySearch.mjs` (live). |
| Assign or revoke tools | **Possible only through source-code modification** | `allowedAgents` is a literal array in `Back/src/lib/toolRegistry.mjs:13-279`. | — |
| Define delegator/approver hierarchy | **Possible only through source-code modification** | Not modelled. `workers` and `qcAgent` are hard-coded; only `qcAgent: 'vera'`. | `Back/src/lib/officeStore.mjs:208-249`; `Back/src/lib/jobRunner.mjs:14`. |
| Assign agent to a job | **Implemented and directly available** | `assignedAgent` field in `create_agent_job` (must be one of `marco|luma|dex`). | `Back/src/lib/toolRegistry.mjs:217-249`; `Back/src/lib/jobRunner.mjs:14`. |
| Monitor idle/working/reviewing/offline | **Implemented and directly available** | `GET /api/office-map` returns runner status; UI surfaces it in `OfficeMapPage`. But the *idle* state per agent is derived from absence of active jobs; there is no real online/offline probe per agent (ollama is one shared service). | `Back/src/controllers/OfficeController.mjs:202-217`; `Front/src/pages/OfficeMapPage.jsx`. |

## 2. Tool lifecycle management

| Capability | Current status | Evidence |
|---|---|---|
| List every registered tool | **Implemented and directly available** | `GET /api/tools?agentId=…`; `listTools(agentId)` filters by `allowedAgents`. | `Back/src/controllers/OfficeController.mjs:64-66`; `Back/src/lib/toolRegistry.mjs:282-285`. |
| Inspect description + input schema | **Implemented and directly available** | Same registration list. | `Back/src/lib/toolRegistry.mjs:13-279`. |
| Identify which agents can use which tools | **Implemented and directly available** | `tool.allowedAgents`. | `Back/src/lib/toolRegistry.mjs:13-279`. |
| Invoke a tool | **Implemented and directly available** | `POST /api/tools/{toolName} { agentId, args }`; `executeTool` enforces allowlists. | `Back/src/controllers/OfficeController.mjs:68-72`; `Back/src/lib/toolRegistry.mjs:289-294`. |
| Grant a tool to an agent | **Possible only through source-code modification** | No mutation API for `allowedAgents`. | — |
| Revoke a tool from an agent | **Possible only through source-code modification** | Same. | — |
| Create a new tool | **Possible only through source-code modification** | No dynamic registration. | — |
| Update schema or implementation | **Possible only through source-code modification** | Same. | — |
| Disable a tool globally | **Possible only through source-code modification** | No kill-switch. | — |
| Delete a tool | **Possible only through source-code modification** | Same. | — |
| Test a tool safely | **Implemented in UI/API but not available to Nora as a free agent** | `Front/src/pages/ToolsPage.jsx` lets Nora choose tools and run them with JSON args. The endpoint itself is reachable for Nora with any `agentId` because `executeTool` allows whatever is passed. So Nora can run any tool for `agentId='nora'`. Tools `allowedAgents`-restricted to other agents will reject. | `Front/src/pages/ToolsPage.jsx:31-67`; `Back/src/lib/toolRegistry.mjs:289-294`. |
| Inspect tool failures | **Implemented and directly available** | Tool errors are returned in the `{ error: … }` shape and surface in `toolEvents`. Front-end message drawer shows tool JSON. | `Back/src/lib/agentRunner.mjs:139-168`; `Front/src/pages/ChatPage.jsx` (transcript rendering). |
| Audit historical tool calls | **Implemented and directly available** | `assistant` messages carry `toolEvents`; `officeStore.mjs` persists them in the conversation's `toolEvents` array via `messageMarkdown`. | `Back/src/lib/officeStore.mjs:248-271`. |
| Distinguish read-only from side-effecting tools | **Partially implemented** | `executeTool` enforces allowlists but no tool declares an `effects` enum. Only "mutating" today is detected by my own manual classification (above). | — |
| Require approval before destructive tools | **Not implemented** | No approval gate logic exists. | — |
| Rate limits, quotas, execution limits | **Not implemented** | Only `maxToolRounds` caps internal agent loops; no cross-tool or per-tool limit. | `Back/src/lib/agentRunner.mjs:25,79-99`; `Back/src/agents/agents.config.mjs:73`. |
| Scoped filesystem / GitHub / browser / email / calendar / deployment / messaging tools | **Not implemented** | `projectFiles.mjs` gives scoped read-only file access. No GitHub, email, calendar, deployment, or messaging tool exists. | `Back/src/lib/toolRegistry.mjs:13-279`. |

## 3. Access control and authority

| Control | Current status | Where it is (and is not) enforced |
|---|---|---|
| Per-agent tool allowlist | **Implemented through an existing tool** | `Back/src/lib/toolRegistry.mjs:13-279` `allowedAgents`; enforced at runtime by `executeTool` (`Back/src/lib/toolRegistry.mjs:289-294`). Static; not mutable from Nora. |
| Per-tool agent allowlist | **Implemented through an existing tool** (same as above) | — |
| Role-based access control (RBAC by user role) | **Not implemented** | No user concept at all; Carlos is the only human; `127.0.0.1` binding implied in `SettingsPage.jsx`. |
| Read / write / execute distinctions | **Partially implemented** | Tools declare `inputSchema`; backend does not label read/write. Effect discrimination is by inspection. |
| Repository path restrictions | **Implemented and directly available** | `safeProjectPath` blocks `.git`, `node_modules`, `dist`, `build`, `coverage`, `.env*` and any path that escapes the project root. | `Back/src/lib/projectFiles.mjs:9-26`. |
| Vault-folder restrictions | **Partially implemented** | `assertVaultPath` prevents escaping the vault. No folder-level allow/deny list exists; any folder is writable via `memory_write`. | `Back/src/lib/officeStore.mjs:38-46`. |
| Approval gates | **Possible only through source-code modification** | None exist. Today, `create_agent_job` runs automatically. | `Back/src/lib/toolRegistry.mjs:217-249`; `Back/src/lib/jobRunner.mjs:54-72`. |
| Destructive-action protection | **Implemented in UI/API but not available to Nora beyond chat delete** | Only `DELETE /api/conversations/{conversationId}` exists; no agent or memory or job delete. | `Back/src/modules.config.mjs:14`. |
| User-level permissions | **Not implemented** | No concept of multiple users. |
| Secrets isolation | **Implemented in UI/API but not available to Nora** | Provider keys live in backend env; agent-config UI never requests them (`Front/src/pages/AgentsPage.jsx`). |
| Network-access restrictions | **Implemented and directly available** | `fetchUrl.mjs` blocks private network addresses. | `Back/src/lib/fetchUrl.mjs` (referenced by `toolRegistry.mjs`). |
| External-service authorization | **Implemented in UI/API but not available to Nora** | Only Ollama HTTP is reachable via `list_ollama_models`. Outbound provider calls (OpenAI et al.) require backend env credentials; no tool opens an arbitrary external API today. | `Back/src/lib/toolRegistry.mjs:194-205`; `ai.mjs`. |
| Audit logs | **Implemented and directly available** | Conversation, job, agent-config frontmatter all serve as audit. Tool events persisted in conversations. | `Back/src/lib/officeStore.mjs` (entire file). |
| Access revocation | **Implemented and directly available** | `PUT /api/agents/{agentId}` can set `enabled=false` to soft-disable an agent. There is no per-tool revocation. | `Back/src/controllers/OfficeController.mjs:46-58`. |
| Temporary permissions | **Not implemented** | No TTL on any capability. |
| Permission expiry | **Not implemented** | — |
| Environment-based restrictions | **Partially implemented** | `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_FALLBACK_MODEL`, `MAX_ATTACHMENT_BYTES`, `MAX_ATTACHMENTS_TOTAL_BYTES`, `MAX_TEXT_ATTACHMENT_CHARS`, `PROJECT_ROOT` are env-controlled. No policy layer uses them. | `Back/src/lib/officeStore.mjs:24-27`; `Back/src/agents/agents.config.mjs:62-87`; `Back/src/lib/projectFiles.mjs:6`. |
| Local-only enforcement | **Partially implemented** | Documented in UI but not technically enforced — Ollama may run on the same loopback or anywhere reachable via `OLLAMA_BASE_URL`. | `Front/src/pages/SettingsPage.jsx`. |

**Prompt-only soft controls:** The "shared rules" preamble (`Back/src/agents/agents.config.mjs:3-21`) instructs agents to refuse publishing, spending money, sending messages, deploying, deleting data, or changing credentials. These are prompt-level social controls with no technical enforcement behind them; nothing in the runtime aborts a tool call that violates them. They work because the model cooperates, not because the platform prevents misuse.

## 4. Delegation and work management

| Capability | Current status | Evidence |
|---|---|---|
| Create jobs | **Implemented and directly available** | `create_agent_job`. | `Back/src/lib/toolRegistry.mjs:217-249`. |
| Choose the worker | **Implemented and directly available** | Enum `marco|luma|dex`. | Same. |
| Define expected results | **Implemented and directly available** | `expectedResult` field. | Same. |
| Define acceptance criteria | **Implemented and directly available** | `acceptanceCriteria[]`, max 20, min 1. | Same. |
| Set priority | **Implemented and directly available** | Enum `low|normal|high`. | Same. |
| Set iteration limits | **Implemented and directly available** | `maxIterations` 1–8 (default 4). | Same. |
| Start / queue jobs | **Implemented and directly available** | `create_agent_job(autoRun=true)`; `POST /api/jobs/{jobId}/run`; `enqueueJob`. | `Back/src/lib/toolRegistry.mjs:217-249`; `Back/src/lib/jobRunner.mjs:200-218`. |
| Inspect current job state | **Implemented and directly available** | `list_agent_jobs`, `get_agent_job`, `GET /api/jobs/{jobId}`. | `Back/src/lib/toolRegistry.mjs:251-279`; `Back/src/modules.config.mjs:16-18`. |
| Inspect inter-agent messages | **Implemented and directly available** | `attempts` and `messages` arrays persisted with type/from/to/iteration. | `Back/src/lib/officeStore.mjs:208-308`. |
| Inspect every worker output and Vera review | **Implemented and directly available** | `attempts[*].workerOutput`, `qcVerdict`, `qcSummary`, `qcFeedback`, `missing`. | Same. |
| Continue failed or unaccepted jobs | **Implemented and directly available** | `retry_agent_job` adds up to 2 bounded iterations (max 8 total). | `Back/src/lib/jobRunner.mjs:220-235`. |
| Cancel a queued job | **Not implemented** | `runJob` only enqueues; no status `cancelled`. Cancellation exists in the UI mapping but no backend verb. | `Front/src/pages/JobsPage.jsx:13-22`; `Back/src/lib/jobRunner.mjs`. |
| Pause a running job | **Not implemented** | No `paused` status; queue chain is `Promise.resolve()`-based. | `Back/src/lib/jobRunner.mjs:9-13,188-218`. |
| Reassign a job | **Not implemented** | `assignedAgent` is immutable after creation. | `Back/src/lib/officeStore.mjs:208-249`. |
| Modify requirements after creation | **Not implemented** | `createJob` builds once; `updateJob` does not surface edits to `instructions`, `expectedResult`, `acceptanceCriteria`. | `Back/src/lib/officeStore.mjs:308-373`. |
| Archive or delete a job | **Not implemented** | `DELETE /api/jobs/{jobId}` route is absent. | `Back/src/modules.config.mjs`. |
| Prevent duplicate jobs | **Not implemented** | Nothing de-duplicates by instruction hash. | — |
| Define job dependencies | **Not implemented** | No precedence graph. | — |
| Sequential or parallel workflows | **Possible only through source-code modification** | Queue is FIFO; no parallel/orchestration layer. | `Back/src/lib/jobRunner.mjs:9-13,188-218`. |
| Enforce deadlines | **Not implemented** | No due-date or timeout. | — |
| Notify Carlos when intervention is required | **Implemented and directly available** | Job status `awaiting_approval` after iteration cap and `failed` states are returned by `list_agent_jobs`; UI surfaces "Continue" button. But there is no proactive push — Carlos must load the app. | `Back/src/lib/jobRunner.mjs:177-186`; `Front/src/pages/JobsPage.jsx:6-22,98-143`. |

## 5. Vera quality control

| Capability | Current status | Evidence |
|---|---|---|
| Require Vera for every delegated job | **Implemented and directly available** (hard-coded) | `qcAgent: 'vera'` literal in the job shape; `runJobLoop` always asks `runAgent('vera', …)`. | `Back/src/lib/officeStore.mjs:225`; `Back/src/lib/jobRunner.mjs:80-99`. |
| Bypass Vera | **Not implemented** for delegated jobs (no flag). For chat there is no QC at all. | — |
| Change the QC agent | **Possible only through source-code modification** | `qcAgent` is hard-coded. | `Back/src/lib/officeStore.mjs:225`. |
| Change QC criteria | **Implemented and directly available** per-job | `acceptanceCriteria[]`. There is no global QC rubric. | `Back/src/lib/officeStore.mjs:236-242`. |
| Inspect Vera's complete reasoning record | **Implemented and directly available** | `attempts[*].qcSummary`, `qcFeedback`, `missing`, `qcModel`. Vera runs with `temperature: 0.1` and is forced to emit a JSON verdict. | `Back/src/agents/agents.config.mjs:73`; `Back/src/lib/jobRunner.mjs:42-72`. |
| Enforce structured verdicts | **Implemented and directly available** | `parseReview` extracts JSON `{verdict, score, summary, feedback, missing}`; if missing or invalid, the iteration is treated as `revise` with `missing: ['Valid structured QC verdict']`. | `Back/src/lib/jobRunner.mjs:106-127`. |
| Cap revision loops | **Implemented and directly available** | `maxIterations` 1–8 (default 4); further continuation is opt-in via `retry_agent_job`. | `Back/src/lib/toolRegistry.mjs:217-249`; `Back/src/lib/jobRunner.mjs:220-235`. |
| Continue a job after the cap | **Implemented and directly available** | `retry_agent_job` extends cap by up to 2, capped at 8 total. | `Back/src/lib/jobRunner.mjs:220-235`. |
| Detect contradictory / impossible criteria | **Implemented in UI/API but not available to Nora as deterministic validation** | No pre-flight check; only Vera's judgement loop catches this empirically. | — |
| Escalate unresolved work to Carlos | **Implemented and directly available** | `awaiting_approval` status; surfaced in Jobs page. No push notification, only visible state. | `Back/src/lib/jobRunner.mjs:177-186`; `Front/src/pages/JobsPage.jsx:6-22`. |
| Prevent Vera from introducing subjective scope | **Partially implemented** | Job-runner feeds Vera only the worker output, instructions, and criteria; Vera is told "do not require optional polish". But Vera is an LLM and cannot be hard-capped on subjective outputs. | `Back/src/lib/jobRunner.mjs:42-72`. |
| Audit accepted work later | **Implemented and directly available** | Job files persist forever under `40-Jobs/` Markdown. | `Back/src/lib/officeStore.mjs:316-373`. |

## 6. Models and providers

| Capability | Current status | Evidence |
|---|---|---|
| Inspect installed Ollama models | **Implemented and directly available** | `list_ollama_models`; `GET /api/models?provider=ollama`. | `Back/src/lib/toolRegistry.mjs:186-200`; `Back/src/controllers/OfficeController.mjs:60-66`. |
| Choose an agent's primary model | **Implemented and directly available** | `model` in `allowedConfigFields`. | `Back/src/controllers/OfficeController.mjs:11-14`. |
| Choose its offline fallback | **Implemented and directly available** | `fallback` in `allowedConfigFields`. | Same. |
| Configure different models per agent | **Implemented and directly available** | Yes — five agents today (nora, marco, luma, dex, vera). | Live `list_agents`. |
| Change temperature | **Implemented and directly available** | `temperature` in `allowedConfigFields`. | `Back/src/controllers/OfficeController.mjs:11-14`. |
| Change maximum tool rounds | **Implemented and directly available** | `maxToolRounds` in `allowedConfigFields`, capped 0–12. | Same. |
| Enable or disable cloud fallback | **Implemented and directly available** (via `fallback.enabled`) | Same. |
| Distinguish connectivity failure from auth/quota/configuration | **Implemented in UI/API but not available to Nora as structured signal** | `connectivity.mjs` decides; on connectivity failure only, `fallbackConfig` is used. For Vera, this is reported via `workerModel.fallbackUsed`. But individual failure modes are not separately surfaced to the user. | `Back/src/lib/connectivity.mjs`; `Back/src/lib/agentRunner.mjs:55-78`. |
| Monitor which model answered each message | **Implemented and directly available** | Each assistant message persists `model: { provider, model, fallbackUsed, primaryModel, fallbackReason }`. | `Back/src/lib/agentRunner.mjs:175-183`; `Back/src/lib/officeStore.mjs:228-238`. |
| Enforce local-only execution for selected agents | **Not implemented** | Only soft "Routing" copy in `SettingsPage.jsx`. No agent-level `localOnly` flag. | — |
| Test model availability before assigning it | **Implemented in UI/API but not available to Nora as a workflow** | `GET /api/models?provider=ollama` lists but doesn't ping. UI `Refresh Ollama` button at `Front/src/pages/AgentsPage.jsx:111-127` only refreshes the dropdown. No availability probe per model. | — |
| Manage provider credentials safely | **Implemented in UI/API but not available to Nora** | Settings copy says keys come from env and never the browser; no credential-management UI. | `Front/src/pages/SettingsPage.jsx`. |

## 7. Memory and knowledge governance

| Capability | Current status | Evidence |
|---|---|---|
| Search permanent memory | **Implemented and directly available** | `memory_search` calls `searchMemory`. | `Back/src/lib/toolRegistry.mjs:14-26`; `Back/src/lib/memory.mjs`; live `memory_search`. |
| Read notes | **Implemented and directly available** | `memory_read`; `GET /api/memory/read?path=…`. | `Back/src/lib/toolRegistry.mjs:28-39`; `Back/src/controllers/OfficeController.mjs:74-78`. |
| Create notes | **Implemented and directly available** | `memory_write` with `mode='create'`. | `Back/src/lib/toolRegistry.mjs:41-70`; `Back/src/lib/memoryWrite.mjs`. |
| Append to notes | **Implemented and directly available** | `mode='append'`. | Same. |
| Replace notes | **Implemented and directly available** | `mode='replace'`. | Same. |
| Delete notes | **Not implemented** | No `memory_delete` tool or route; vault-only filesystem removal is not surfaced. | `Back/src/lib/toolRegistry.mjs:13-279`; `Back/src/modules.config.mjs`. |
| Archive stale notes | **Not implemented** | No `status`/`archived`/`superseded` semantics. | — |
| Correct false notes | **Partially implemented** | `replace` mode exists, but there is no audit trail of who replaced what, no integrity hash, and no diff view. | `Back/src/lib/memoryWrite.mjs`. |
| Mark notes as superseded | **Not implemented** | No `supersededBy` field. | — |
| Separate shared and agent-specific knowledge | **Implemented in UI/API but not available to Nora as a controlled workflow** | `scope: 'shared'|'agent'|'inbox'` parameter exists, but `memoryWrite.mjs` routing details must be inspected to confirm whether each scope is honoured identically. (Per shared rules, worker writes to `shared` are routed to `inbox`; Nora curates them.) | `Back/src/lib/toolRegistry.mjs:41-70`; `Back/src/agents/agents.config.mjs:1-21`. |
| Review worker memory proposals | **Implemented in UI/API but not available to Nora as a routine** | `00-Inbox/*.md` notes exist; nothing automatically flags them for curation today. | Live `memory_list` (`00-Inbox`) shows iter-2 and iter-3 UI plan proposals still awaiting Nora. |
| Prevent unverified claims from becoming authoritative | **Possible only through source-code modification** | Nothing tags `confidence`/`source-confidence`. | — |
| Detect contradictions | **Possible only through source-code modification** | No duplicate or contradiction detection. | — |
| Identify stale implementation records | **Partially implemented** | Prior memory describing `apps/api`/`apps/web` is contradicted by the live `Front/ + Back/` layout. Detection today requires a human reading. | `Back/src/lib/runtimeContext.mjs:24`; existing stale notes mentioned in briefing. |
| Maintain authoritative architecture note | **Not implemented** | No canonical `90-System/Carlos Office Architecture.md` enforced. | — |
| Track provenance and source confidence | **Not implemented** | No frontmatter schema requires it. | — |

**Stale records that must be retired:** any note claiming the repo has `apps/api` and `apps/web` directories; the live repo is `Front/ + Back/ JavaScript layout` per `Back/src/lib/runtimeContext.mjs:24`. The persistence of stale `00-Inbox` proposals and obsolete plan notes continues to pull search results.

## 8. Conversations and files

| Capability | Current status | Evidence |
|---|---|---|
| Create conversations | **Implemented and directly available** | `POST /api/chat` with optional `conversationId`. | `Back/src/controllers/OfficeController.mjs:90-176`. |
| Reopen them | **Implemented and directly available** | `GET /api/conversations/{conversationId}`; `saveConversation` reloads. | Same. |
| Append messages | **Implemented and directly available** | Chat route appends user + assistant; controller saves. | Same. |
| Rename them | **Implemented and directly available** | `PUT /api/conversations/{conversationId} {title}`. | `Back/src/controllers/OfficeController.mjs:80-88`. |
| Delete them | **Implemented and directly available** | `DELETE /api/conversations/{conversationId}`. | `Back/src/controllers/OfficeController.mjs:82-85`. |
| Retrieve attachments | **Implemented and directly available** | `GET /api/conversations/{conversationId}/attachments/{attachmentId}`. | `Back/src/controllers/OfficeController.mjs:111-117`. |
| Store attachments | **Implemented and directly available** | `saveConversationAttachments`. | `Back/src/lib/officeStore.mjs:488-518`. |
| Reason over text attachments | **Implemented and directly available** | `hydrateConversationMessages` injects text into `modelContent`. | `Back/src/lib/officeStore.mjs:542-583`. |
| Reason over image attachments | **Partially implemented** | Image MIME is recognised and a `data:` URL is built, but on fallback the image is dropped (text-only fallback drops parts); there is no OCR pass-through. | `Back/src/lib/officeStore.mjs:519-583`; `Back/src/lib/agentRunner.mjs:42-46`. |
| Distinguish unsupported binary attachments | **Implemented and directly available** | `isTextAttachment`/`isImageAttachment`; non-text/image attachments produce a "stored locally but not injected" notice. | `Back/src/lib/officeStore.mjs:519-541,561-571`. |
| Control attachment size limits | **Implemented and directly available** | `MAX_ATTACHMENT_BYTES` (default 8 MB), `MAX_ATTACHMENTS_TOTAL_BYTES` (default 20 MB), `MAX_TEXT_ATTACHMENT_CHARS` (default 200 000), at most 8 attachments per message. | `Back/src/lib/officeStore.mjs:24-27,488-518`. |
| Recover from failed model requests | **Implemented and directly available** | Chat route catches, returns assistant message with `error: true`, and persists. | `Back/src/controllers/OfficeController.mjs:138-156`. |
| Search across conversations | **Not implemented** | `memory_search` searches the vault only. No dedicated conversation-FTS endpoint. | — |
| Summarise old conversations | **Implemented in UI/API but not available to Nora as a service** | Nora can ask any agent (via chat) to summarise; no scheduled summariser. | — |
| Connect a conversation to a delegated job | **Not implemented** | Conversation and job Markdown records have no linking field. | — |
| Transfer a conversation to another agent | **Not implemented** | `chat` route refuses with HTTP 409 if `agentId` differs and there are existing messages. | `Back/src/controllers/OfficeController.mjs:106-110`. |
| Export a conversation | **Not implemented** | Only the underlying Markdown file is the export; no UI button. | — |
| Archive instead of delete | **Not implemented** | Delete is the only verb. | `Back/src/controllers/OfficeController.mjs:82-85`. |
| Each conversation stored as a separate Markdown file | **Implemented and directly available** | `conversationFile(id) = 30-Conversations/Threads/<id>.md`; full transcript serialised with frontmatter and `<!-- carlos-office-conversation -->` block. | `Back/src/lib/officeStore.mjs:233-296`. |

## 9. Monitoring and operational control

Observability today:

| Item | Current status | Evidence |
|---|---|---|
| Backend health | **Implemented and directly available** | `GET /api/health`. | `Back/src/controllers/OfficeController.mjs:18-44`. |
| Ollama connectivity | **Implemented and directly available** | Same endpoint reports `ollama.online` and model count. | Same. |
| Model availability (per model) | **Implemented and directly available** | `list_ollama_models`. | `Back/src/lib/toolRegistry.mjs:186-200`. |
| Active jobs | **Implemented and directly available** | `office-map.runner.active`. | `Back/src/lib/jobRunner.mjs:238-242`; `Back/src/controllers/OfficeController.mjs:202-217`. |
| Queued jobs | **Implemented and directly available** | `office-map.runner.queued`. | Same. |
| Active agents (pseudo) | **Implemented and directly available** | Computed from active jobs in `OfficeMapPage.jsx`. | `Front/src/pages/OfficeMapPage.jsx`. |
| Current job stage | **Implemented and directly available** | Per-agent `stage` field in `active` map: `working | reviewing | accepted`. | `Back/src/lib/jobRunner.mjs:78-83,156-186`. |
| Job iteration | **Implemented and directly available** | `currentIteration / maxIterations`. | `Back/src/lib/jobRunner.mjs:80-99`. |
| Vera review state | **Implemented and directly available** | `qcVerdict`, `qcScore`, `qcFeedback`. | Same. |
| Conversation counts | **Implemented and directly available** | `office-map.conversations.length`; per-agent counts. | `Back/src/controllers/OfficeController.mjs:202-217`. |
| Attachment counts | **Implemented and directly available** | `office-map.conversations[*].attachmentCount`. | `Back/src/lib/officeStore.mjs:434-454`. |
| Tool failures | **Implemented and directly available** | Per-message `toolEvents[].failed: true` with `{error}` payload. | `Back/src/lib/agentRunner.mjs:139-168`. |
| Model failures | **Implemented and directly available** | Assistant message with `error: true` and chat route catch. | `Back/src/controllers/OfficeController.mjs:138-156`. |
| Fallback use | **Implemented and directly available** | Assistant `model.fallbackUsed`, `model.fallbackReason`. | `Back/src/lib/agentRunner.mjs:175-183`. |
| Stale / interrupted jobs | **Implemented and directly available** | On boot, `resumePendingJobs` re-enqueues `queued | running | qc_review`. | `Back/src/lib/jobRunner.mjs:225-232`. |
| Backend restarts | **Implemented in UI/API but not available to Nora as a control** | `timestamp` in `/api/health` reflects last poll, no uptime, no version. | — |
| Repository layout and root path | **Implemented and directly available** | `/api/health` reports `localOnly`, `storage`, and indirectly via `projectFiles`. | `Back/src/controllers/OfficeController.mjs:18-44`. |

Active controls today:

| Action | Current status |
|---|---|
| Pause work | **Not implemented** |
| Cancel work | **Not implemented** |
| Restart failed work | **Implemented and directly available** (`retry_agent_job`) |
| Reassign work | **Not implemented** |
| Change priorities after creation | **Not implemented** |
| Resolve deadlocks | **Not implemented** (queue is single-chain `Promise.resolve()`) |
| Limit concurrency | **Possible only through source-code modification** (queue is serial) |
| Set cost or token budgets | **Not implemented** |
| Stop runaway loops | **Implemented in UI/API but not available to Nora as global kill** (`maxToolRounds` per agent; no per-call kill) |
| Notify Carlos of operational incidents | **Not implemented** (only status visible on next refresh) |

## 10. Self-improvement and system evolution

| Capability | Current status | Evidence |
|---|---|---|
| Inspect Carlos Office source code | **Implemented and directly available** | `project_list_files`, `project_read_file`, `project_search_files` for nora/dex/vera. | `Back/src/lib/toolRegistry.mjs:121-181`. |
| Identify defects | **Implemented and directly available** (analysis via chat) | Nora can reason about inspected code and report findings in this audit. | This file. |
| Research better approaches | **Implemented and directly available** | `web_search`, `fetch_url` (private network blocked). | `Back/src/lib/toolRegistry.mjs:72-117`. |
| Create implementation plans | **Implemented and directly available** | Nora may write Markdown plan notes directly to memory. | `Back/src/lib/toolRegistry.mjs:41-70`. |
| Delegate planning to Dex | **Implemented and directly available** | `create_agent_job` for Dex. | `Back/src/lib/toolRegistry.mjs:217-249`. |
| Have Vera validate plans | **Implemented and directly available** | Implied by the standard QC loop. | `Back/src/lib/jobRunner.mjs:80-127`. |
| Directly edit source code | **Not implemented** | No write tool for the repo. `projectFiles` is read-only. | `Back/src/lib/projectFiles.mjs:62-96`. |
| Commit changes | **Not implemented** | No git/GitHub tool. | — |
| Push changes | **Not implemented** | — |
| Run tests | **Not implemented** | No test runner tool; only human or shell-level execution. | — |
| Deploy changes | **Not implemented** | No deploy tool. | — |
| Roll back changes | **Not implemented** | No rollback tool. | — |
| Modify your own instructions | **Possible only through source-code modification** | Nora's system prompt is a string constant in `Back/src/agents/agents.config.mjs`. | — |
| Create new agents / tools without backend code update | **Not implemented** | Static registries. | — |

**Plain verdict:** Nora can analyse and plan; Nora cannot implement. The "self-improvement" loop is bounded to plan-only.

---

## 11. Manager-readiness assessment (yes / no / partially)

| Question | Answer | Explanation |
|---|---|---|
| Can Nora create a new agent without editing source code? | **No** | `agentDefinitions` is static. |
| Can Nora delete or archive an agent? | **No** | No verb; only `enabled = false`. |
| Can Nora define or modify agent system instructions from the UI? | **Partially** | Display `role` is editable; the system prompt string in `agents.config.mjs` is not. |
| Can Nora grant and revoke tools dynamically? | **No** | `allowedAgents` is a hard-coded literal array. |
| Can Nora create a new tool dynamically? | **No** | Tools are static. |
| Can Nora define role-based permissions? | **No** | No role/user model. |
| Can Nora require Carlos's approval for a specific tool? | **No** | No approval gate verb. |
| Can Nora cancel or reassign a running job? | **No** | No cancellation, no reassignment. |
| Can Nora delete or archive jobs? | **No** | No delete/archive route. |
| Can Nora correct or supersede stale memory? | **Partially** | `replace` mode exists; no audit, no `supersededBy`. |
| Can Nora modify Carlos Office source code herself? | **No** | Read-only tool surface. |
| Can Nora commit and push changes? | **No** | No git tooling. |
| Can Nora safely act as the complete system administrator today? | **No** | She can supervise chat, agents' runtime config, memory, jobs (start/continue), and tool invocations, but cannot structurally administer agents, tools, permissions, jobs lifecycle, memory integrity, or source. |
| What can Nora manage autonomously today? | — | (a) Read and update agent runtime config (`provider`, `model`, `fallback`, `temperature`, `enabled`, `maxToolRounds`); (b) start and continue delegated jobs; (c) invoke any tool she is allowed to invoke for herself, including memory reads/writes and web fetch (respecting prompt-level rules); (d) create, rename, delete conversations; (e) read and write Markdown memory scoped under `shared`/`agent`/`inbox`; (f) inspect the live repo and offline Ollama models. |
| What still requires Carlos or a developer? | — | Anything structural: agent identities, system prompts, roles, tools, allowlists, permission policies, approval gates, cancellation/pause/reassignment, memory archival/supersession semantics, source-code edits, tests, deploys, git. |

---

## 12. Target management model (minimum safe manager)

The target must remain local-first, Obsidian-only, JavaScript-only, MiniMax M3 primary + Qwen fallback, Vera QC at every step, and require explicit Carlos approval for anything external or destructive. It must NOT give Nora unrestricted self-modification, credential access, or database back-ends.

Required manager operations, each with hard enforcement, audit, and (where relevant) a Carlos approval gate:

1. **Agent identity and prompt lifecycle.** Add, clone, disable, archive, restore, delete agent identities, with editable display name, role summary, full system prompt, model assignment, fallback, temperature, tool allowlist, max tool rounds, and `localOnly` flag. Writes persist to `90-System/Runtime/Agents/<name>.md` with `supersededBy` chains. Deletion requires Carlos approval and produces an immutable tombstone.
2. **Tool registry metadata.** Create, version, disable, archive, and deprecate tools at runtime with `allowedAgents` declared per tool, an `effects` enum (`read`, `write_state`, `external_network`, `destructive`), a `requiresApproval` flag, and a `cooldownMs`/`maxCallsPerHour` budget. All changes audit-logged.
3. **Permission enforcement.** Hard enforcement (not prompt instructions) of: per-tool agent allowlist, per-agent tool allowlist, effect class permission checks, a per-action approval queue, and a secrets broker that injects credentials so the agent never sees them. Public-internet and filesystem-write classes default to `requiresApproval=true`.
4. **Job control.** Cancel, pause, resume, reassign, change priority, change deadlines, add comments, archive, and delete jobs. Each verb requires the corresponding permission and is journaled in the job's `messages` array.
5. **Memory governance.** `supersededBy`, `archived`, `confidence`, `source`, `provenance`, and `authorityClass` (`authoritative` | `proposed` | `stale` | `archived`) frontmatter keys. Auto-detect contradictions among `authoritative` notes via a nightly Dex job. A canonical `90-System/Carlos Office Architecture.md` is owned by Nora; derived notes cannot claim higher authority.
6. **Operational monitoring and incident response.** Health, agent status, queue depth, job stage, fallback use, and incident ledger. Push-style escalation that opens a Carlos "approval" item rather than just changing a status string.
7. **Immutable audit history.** Every management action appends to an append-only `90-System/Runtime/Audit/YYYY-MM-DD.md` line; entries cannot be edited after commit; deleting an audit line is itself audited.
8. **Safe source-change delegation.** Nora may produce a sealed plan bundle; a Dex job may implement it only after Vera validates; a developer runs `npm install && npm test` and merges. Source writes never happen from inside a tool.
9. **Test and validation requirements.** Every backend change must add or update a Node test under `Back/test/`; every frontend change a Vitest test under `Front/src/__tests__/`; every skill a JSON-Schema fixture.
10. **Rollback boundaries.** All mutations must be reversible through `mode='replace'`, `supersededBy`, or job continuation, except hard tombstones which a Carlos-level approval can lift.
11. **Explicit Carlos-only actions.** (a) Adding a new provider or rotating a credential; (b) changing `qcAgent` away from `vera`; (c) enabling a tool whose `effects` include `external_network` or `destructive`; (d) deleting an authoritative memory record; (e) editing source files; (f) changing Nora's own system prompt.

## 13. Gap analysis

Each gap is graded:

- **C** Critical for management — Nora cannot perform a routine operational duty today.
- **I** Important — common task is awkward today.
- **U** Useful later.
- **R** Should remain intentionally restricted.

| ID | Gap | Class | Current limitation | Affected source | Proposed backend change | Proposed frontend change | Proposed Markdown schema change | Security constraints | Acceptance tests | Migration | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|---|
| G1 | No `create_agent` / `clone` / `archive` / `delete_agent` verbs | **C** | `agentDefinitions` static; no routes in `Back/src/modules.config.mjs` | `Back/src/agents/agents.config.mjs`, `Back/src/lib/officeStore.mjs:106-168`, `Back/src/modules.config.mjs` | Add `agents.config.<name>` writable registry; new `officeStore.mjs` `createAgent`, `archiveAgent`, `cloneAgent`, `deleteAgent`; new routes `POST /api/agents`, `POST /api/agents/{id}/clone`, `POST /api/agents/{id}/archive`, `DELETE /api/agents/{id}`; rev temp migration idempotent | `AgentsPage.jsx`: section for "Lifecycle" with create/archive/clone/delete buttons; modal confirmation | New `lifecycle: active|archived|deleted` and `supersededBy` frontmatter keys on `90-System/Runtime/Agents/*.md`; immutable tombstone Markdown when deleted | Only `nora` may execute; destructive verbs require Carlos approval token; never delete an agent with active jobs | `Back/test/agent.lifecycle.test.mjs` covering create/clone/archive/restore/delete with tombstone assertions | Auto-migrate existing five agents on first deploy | Markdown file remains; revert by reading previous YAML and unsetting `lifecycle` |
| G2 | No tool registry writes | **C** | Tools hard-coded in `Back/src/lib/toolRegistry.mjs:13-279` | `Back/src/lib/toolRegistry.mjs`, `Back/src/mcp/server.mjs` (mirror), `Back/src/controllers/OfficeController.mjs:64-72`, `Back/src/modules.config.mjs` | Move tool registry to vault-driven; each tool a `90-System/Runtime/Tools/<name>.md` with effect class, allowlist, approval flag, rate limits; add `createTool`, `updateTool`, `disableTool`, `deleteTool`; corresponding routes | `ToolsPage.jsx`: lifecycle column; per-tool "Disable" toggle; effect class badge | Tool frontmatter: `effectClass`, `requiresApproval`, `cooldownMs`, `maxCallsPerHour`, `supersededBy` | Allowlist by `tool.allowedAgents`; `destructive|external_network` always requires Carlos approval; secrets never appear in arguments | `Back/test/tool.registry.test.mjs` for create/update/allowlist; integration test that asserts a `destructive` tool blocks without approval token | First-run migration materialises five default tools | Disable keeps registry; restore by removing `disabled: true` |
| G3 | No permission / approval gate enforcement | **C** | All controls are prompt-instructions in the system preamble | `Back/src/agents/agents.config.mjs:1-21`, `Back/src/lib/agentRunner.mjs`, `Back/src/lib/toolRegistry.mjs:289-294`, `Back/src/controllers/OfficeController.mjs:18-217` | Introduce `permission.mjs` that classifies `effects` and resolves `requiresApproval`; integrate into `executeTool` to return `{ approvalRequired: '<token-id>' }` instead of running; new `POST /api/approvals/{id}/grant` and `/deny` routes | Modal-style "Carlos approval" centre; queue visible in Sidebar; Jobs page banner when blocked | `90-System/Runtime/Approvals/<id>.md` with `state: pending|granted|denied|expired`, `requestedBy`, `reason` | Approval must originate from `127.0.0.1` only; tokens expire in ≤ 15 min; nothing crosses a network boundary without grant | Tests that a `destructive` call returns `approvalRequired` without an `approver=car…` header and proceeds when present | None required; new behaviour additive | Remove approval layer; tools run as before |
| G4 | No job cancel/pause/reassign/repriority/delete/archive/deadline | **C** | `runJobLoop` is a serial single-direction loop | `Back/src/lib/jobRunner.mjs:54-186` | Add `status: paused|cancelled|archived`; add `cancelJob`, `pauseJob`, `reassignJob`, `setPriority`, `setDeadline`, `archiveJob`, `deleteJob`; `runJobLoop` checks pause/cancel tokens between iterations; queue supports optional `dependencies: [<jobId>]` | Jobs page: row-level context menu with the verbs; banner when awaiting approval or dependency | `agent-job` frontmatter: `deadline`, `dependencies`, `priority`, `assignedAgent` (mutable), `pausedAt`, `cancelledAt`, `archiveReason` | `cancel` of a running job is best-effort: kill the worker on next `toolEvent` boundary only; never kill mid-stream of an Ollama call; reassignment requires Vera acknowledgement | Tests for each verb with race-window simulation; panic-button test for `cancel` | Migrate by adding default fields; do not alter status of in-flight jobs | Each verb journals with an undo link in the messages array |
| G5 | No memory archival, supersession, provenance, contradictions | **C** | Vault Markdown with no schema | `Back/src/lib/memoryCore.mjs`, `Back/src/lib/memorySearch.mjs`, `Back/src/lib/memoryWrite.mjs` | Add `supersedeNote(oldPath, newPath)`, `archiveNote(path)`, `appendProvenance(path, source, confidence)`, `contradictionScan()`; extend `memory_write` schema; reject writes that lower `authorityClass: authoritative` without Carlos approval | Memory page (new) or Tools page extension: visual `authorityClass` chips, "supersede this" action | New frontmatter: `authorityClass`, `provenance`, `confidence`, `supersededBy`, `archived` | `authoritative` writes always require Carlos approval; `contradictionScan` runs in a Dex job nightly | Tests for supersession chain; test that authoritative write without approval is rejected | On first deploy, mark current architecture notes as `authorityClass: authoritative` | Removing the field resets to default proposed |
| G6 | Source layout drift (stale `apps/api` / `apps/web` records) | **I** | Notes from before the `Front/ + Back/` rename are still in the vault | `Back/src/lib/runtimeContext.mjs:24`; vault search | Add `dex.knowledgeSweep` nightly job that flags notes whose path prefixes match known-removed roots | Settings page: "Knowledge health" card showing contradictory notes | `provenance` and `architecture-truth: 90-System/Carlos Office Architecture.md` indicator | Read-only sweep; writes are proposals only | Sweep test asserts a fabricated `apps/api/*.md` is flagged | Run sweep on existing vault; curate inbox proposals | Disable sweep job |
| G7 | No consolidated audit log | **C** | Audit only exists implicitly in job/conversation/agent-config Markdown | `Back/src/lib/officeStore.mjs` (entire) | Introduce `appendAudit({ actor, verb, target, before, after })`; append to `90-System/Runtime/Audit/YYYY-MM-DD.md`; add `GET /api/audit` query | New "Audit" panel; export to Markdown | File-per-day append-only; entries are JSON within Markdown fenced blocks; daily file hashed and chained | Append-only enforced by removing `mode='replace'`; only `mode='append'` allowed for that path | Test that repOpen removes earlier lines is blocked; tamper is detectable | Seed with today's already-recorded actions | Removing `appendAudit` calls |
| G8 | No session/auth model; "Carlos" is implicit | **I** | `127.0.0.1` binding only is documented | `Back/src/modules.config.mjs`, `Back/src/Router.mjs` | Add explicit `requireCarlos(action)` middleware: reads a short-lived bearer from a local file written by a helper (out-of-band challenge). Mid-impact actions require the token; high-impact require it and a one-time response | A four-eyes modal: one prompt, one action, cancel beats accidental clicks | `90-System/Runtime/ApprovalTokens/<id>.md` | Token file chmod 600; never logged; revoked after use | Token tests; rejected without token; allowed with token | Generate initial token on first run | Disable middleware via env flag |
| G9 | No secrets broker for non-Ollama providers | **R (keep restricted)** | Keys live in env today; UI explicitly does not collect them | `Back/src/lib/ai.mjs`; `Front/src/pages/SettingsPage.jsx` | Implement broker that fronts provider calls so the agent never sees the key | None for now | None | Agent never sees raw credentials; broker logs only provider/model/byte-count | Broker unit tests with masked-key responses | On next provider enable | Disable broker; tokens kept in env |
| G10 | No `nora.mutate.source` tool; cannot self-implement | **R (keep restricted)** | Source editing is intentionally not exposed | `Back/src/lib/projectFiles.mjs` | None (intentional). Self-implementation should remain gated to a Dex plan + developer merge | None | None | Source-code writes are a developer step; no tool should ever gain `path: Back/**` write authority | None | None | — |
| G11 | Deadlines, dependencies, parallel workflows | **U** | Today jobs are serial FIFO | `Back/src/lib/jobRunner.mjs:9-13,188-218` | Add DAG scheduler, edge types `wait_for`, `wait_for_success`; `deadline` checker | Jobs page: DAG view | Job frontmatter: `dependsOn: []`, `deadline` | Hard deadline cap; cascade-cancel on missed deadlines | DAG cycle-detection tests | None required | Revert by flattening edges |
| G12 | Cost / token / runtime budgets | **U** | `maxToolRounds` is the only cap | `Back/src/lib/agentRunner.mjs:79-99`; `Back/src/agents/agents.config.mjs:73` | Add `maxTokens`, `maxWallClockMs`, `maxEstimatedCostCents` per agent | Settings page card; per-agent summary | Per-agent frontmatter | Hard stop beyond limit; partial result retained | Tests asserting hard limits abort without corruption | None | Removing fields restores unbounded behaviour |
| G13 | Incident notifications | **I** | Status only visible on next poll | `Front/src/pages/JobsPage.jsx`, `Back/src/lib/jobRunner.mjs:177-186` | Add `incident.mjs` that watches `office-map` and pushes an `incident` Markdown + an OS notification (web Notification API) | Sidebar badge counter; banner modal | `90-System/Runtime/Incidents/<id>.md` with `severity`, `kind` | Nothing escalates to external systems; OS notification only | Tests for `failed→incident` propagation | None | Disable incidencter; status only |
| G14 | Session identity for "Carlos" inside MCP server | **R (keep restricted)** | MCP today runs as `nora` regardless | `Back/src/mcp/server.mjs:14-19` | Tighten so MCP-issued actions must declare an `actor: carlos|nora|dex|luma|vera`; cross-actor verifications hard-fail | New MCP tool `actor_set` | None | Every MCP call logs actor; verifier cross-checks against action verb allowlist | Tests for actor mismatch | None | Revert by removing `actor` requirement |
| G15 | Self-prompt editing | **R (keep restricted)** | Nora's instructions live in `agents.config.mjs` | `Back/src/agents/agents.config.mjs:13-78` | Implement a sealed system-prompt hash; prompt edits require source recompile | None for now | `promptVersion`, `promptHash` | Hash mismatch aborts agent calls; only Carlos approval can edit | Hash-test that mutation breaks agent runs | Seed a known hash | Revert by hard-coding prompt |
| G16 | Audit archival retention | **U** | Files persist forever | `Back/src/lib/officeStore.mjs` | Add 7-year per-day pruning (manual) | None for now | None | Read-only after 7 years; pruning itself audited | Test files remain intact across runs | None required | Disable pruning |

**Security and least-privilege posture to preserve across every gap:**

- Tools must declare `effects` and `requiresApproval`; an approval token is required for any class besides `read`.
- All destructive verbs journal with `before` and `after` snapshots.
- Vera must QC every concrete management plan before Nora acts; plans that are vague, overprivileged, or that ask for credential exposure are rejected.
- Source files are never writable from a tool.
- Credentials are never visible to agents; only the broker sees them.
- "Carlos" approval is a local token issued out-of-band; remote callers have no path to grant it.

---

## 14. Delegation: Dex planning job

A bounded Dex planning job is created next (see response payload) to produce an implementation-ready plan that operationalises this audit without modifying source code.

---

## 15. Reading priority for future audits

When re-running this audit in the future:

1. Verify that `Back/src/lib/runtimeContext.mjs:24` still returns `"Front/ + Back/ JavaScript layout"`.
2. Verify `Back/src/modules.config.mjs` route list and `Back/src/lib/toolRegistry.mjs` definitions.
3. Verify agent registry in `Back/src/agents/agents.config.mjs`.
4. Read the latest `docs/*` plan only if the Dex job has materialised it; otherwise treat vault inbox proposals as unverified.
5. Treat claims about `apps/api`/`apps/web` as stale unless re-confirmed.
