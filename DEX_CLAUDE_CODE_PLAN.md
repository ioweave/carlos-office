# Dex as a Personalized Claude Code Alternative

## Goal

Turn Dex from a delegated development worker into Carlos's local, model-agnostic coding environment: repository-aware, editable, testable, extensible through skills/plugins/MCP, safe by default, and integrated with Nora/Vera rather than operating as an isolated terminal agent.

This should not be a literal Claude Code clone. Carlos Office already has advantages Claude Code does not share in the same form: permanent Obsidian memory, Nora orchestration, Vera acceptance, the Office Map, local-company context, MiniMax M3 primary routing, and local Qwen fallback. Dex should adopt the strongest coding-agent patterns while remaining native to that architecture.

## What Claude Code currently gets right

Current Claude Code documentation exposes several architectural ideas worth reproducing:

1. **A simple agentic execution loop surrounded by strong controls.** The model explores files, edits, runs tools, observes results, and repeats, while permission modes bound what tools may execute.
2. **Session continuity.** CLI sessions can be continued or resumed by identifier rather than restarting context every time.
3. **Project instructions and reusable skills.** Skills are filesystem packages centered on `SKILL.md`; they are discovered and loaded when relevant instead of injecting every procedure into every prompt.
4. **Specialized subagents.** Subagents can receive specific tools, model/effort/turn limits, skills, memory, background execution and worktree isolation.
5. **Hooks.** Deterministic lifecycle handlers can run before/after tool use and at other execution events, allowing rules to be enforced outside the model prompt.
6. **MCP.** External services are attached through a standard tool protocol rather than hard-coded into the coding loop.
7. **Plugins.** A plugin can bundle skills, agents, hooks, MCP servers, LSP servers, monitors, commands/themes and executables in one versioned package.
8. **Marketplaces.** Plugin catalogs add discovery, versioning and updates rather than requiring manual copying of prompt files.
9. **Permission granularity.** Allowed/disallowed tools and permission modes are explicit runtime concepts; unrestricted execution is an exceptional mode rather than the default.
10. **Worktree isolation.** Parallel coding tasks can be placed in isolated Git worktrees rather than competing in the same working tree.

## Current Dex baseline

After the agent-capability upgrade Dex already has:

- repository listing, reading and search;
- atomic source writes with optional stale-read SHA guards;
- bounded Node syntax checks, Git status/diff/log/show and declared npm scripts;
- optional dependency installation behind an explicit environment gate;
- source deletion and deploy/release execution behind separate gates;
- Playwright inspection/interactions for local UI verification;
- Browser MCP access for the real logged-in browser;
- generic MCP discovery/calls;
- optional official GitHub MCP profile;
- permanent Dex memory and working files;
- Vera independent verification;
- Nora final plan approval.

This is enough for controlled implementation jobs but not yet enough to replace Claude Code as Carlos's interactive daily coding environment.

## Target architecture

```text
Carlos
  │
  ├── Interactive Dex coding session
  │      │
  │      ├── Context manager
  │      ├── Skill resolver
  │      ├── Plugin registry
  │      ├── Permission engine
  │      ├── Tool/MCP router
  │      ├── Hook lifecycle
  │      ├── Git/worktree manager
  │      ├── Test/LSP diagnostics
  │      └── Session/checkpoint store
  │
  └── Nora plan → Dex job → Vera verification → Nora approval
```

Interactive Dex and delegated Dex jobs should share the same underlying tool, skill, plugin, permission and repository services.

## Phase 1 — Coding kernel

### Build

Create a dedicated `Back/src/dex/` domain rather than continuing to grow generic tools:

- `DexSession.mjs` — session lifecycle and persistent transcript metadata.
- `DexContext.mjs` — repository map, bounded file selection, context compaction and source authority.
- `DexExecutor.mjs` — structured tool loop around `runAgent`.
- `DexPermissions.mjs` — explicit permission decisions.
- `DexGit.mjs` — status/diff/branch/worktree primitives.
- `DexCheckpoints.mjs` — before/after hashes and reversible file snapshots.

### Required capabilities

- open/resume/continue a coding session;
- stream visible model output and tool events;
- read/search/edit/create files;
- multi-file atomic edit transaction;
- patch/diff presentation before final acceptance;
- bounded command execution with command policy rather than generic unrestricted shell;
- test/build/lint/script discovery from package metadata;
- Git status/diff/history/branch inspection;
- explicit checkpoint before source mutations;
- restore a checkpoint;
- cancel the current model/tool operation.

### Acceptance

Dex can take a repository issue from investigation through implementation and verified local diff without Nora needing to manually relay file contents.

## Phase 2 — Permission engine

Replace scattered environment flags with one central policy evaluator.

Suggested decision states:

- `allow` — safe read/inspection;
- `allow-session` — Carlos approved for the current session;
- `allow-project` — durable approval for this repository;
- `ask` — UI permission card required;
- `deny` — technically blocked.

Policy dimensions:

- agent;
- tool;
- action classification;
- repository/path;
- command + arguments;
- network destination;
- external service;
- current job/session;
- destructive/reversible flag.

Never create a global "skip all permissions" default.

## Phase 3 — Skills

Adopt the Agent Skills convention rather than inventing an incompatible prompt format.

Suggested layout:

```text
.skills/
  frontend-quality/
    SKILL.md
    references/
    scripts/
  node-backend/
    SKILL.md
  debugging/
    SKILL.md
```

Also support a user-level directory such as:

```text
~/CarlosOffice/skills/
```

Each `SKILL.md` should include metadata for:

- name;
- description/trigger;
- allowed agents;
- required tools;
- optional model preference;
- supporting files;
- validation scenarios.

Load skill descriptions into the resolver; load full skill content only after selection. This prevents skill libraries from consuming the context window.

## Phase 4 — Plugin system

Use a Carlos Office plugin format intentionally compatible in spirit with Claude Code plugins.

```text
my-plugin/
  carlos-plugin.json
  skills/
  agents/
  hooks/
  mcp.json
  lsp.json
  monitors/
  bin/
```

Manifest example:

```json
{
  "name": "frontend-quality",
  "version": "1.0.0",
  "description": "Carlos's frontend engineering workflow",
  "skills": ["skills/frontend-quality"],
  "hooks": "hooks/hooks.json",
  "mcp": "mcp.json",
  "agents": [],
  "permissions": []
}
```

### Plugin lifecycle

- discover;
- inspect manifest and requested capabilities;
- install to a local plugin store;
- enable/disable globally or per project;
- update;
- rollback;
- uninstall;
- show provenance/version/hash;
- never automatically grant requested permissions on install.

A Claude Code compatibility importer can later translate common plugin components (`skills/`, `agents/`, `hooks/`, `.mcp.json`) into Carlos Office equivalents where semantics match.

## Phase 5 — Hooks

Hooks provide deterministic enforcement where prompts are insufficient.

Initial events:

- `SessionStart`;
- `BeforeModel`;
- `BeforeTool`;
- `AfterTool`;
- `ToolError`;
- `BeforeWrite`;
- `AfterWrite`;
- `BeforeCheck`;
- `AfterCheck`;
- `BeforeJobAcceptance`;
- `SessionEnd`.

Useful built-in hooks:

- block `.env`/secret reads;
- run formatter/check after source edits when configured;
- require BEM/mobile-first audit when frontend SCSS is modified;
- snapshot files before mutation;
- prevent dependency installation without permission;
- prevent Git remote mutation without permission;
- write a concise technical lesson to Dex memory after accepted jobs.

Hooks must have execution timeouts and explicit allowed commands. Plugin hooks are untrusted code until Carlos grants them authority.

## Phase 6 — Subagents and worktrees

Dex should be able to create bounded technical subagents without turning every Carlos Office worker into a coding agent.

Useful built-ins:

- code explorer — read-only architecture tracing;
- implementation agent — scoped edit permissions;
- test agent — read + checks, no writes unless explicitly assigned;
- code reviewer — read-only diff review;
- UI verifier — Playwright and screenshots.

Parallel write-capable work should use Git worktrees:

```text
90-System/Runtime/Worktrees/<session>/<subagent>/
```

Merge into the main working tree only after conflict detection and Vera/Nora acceptance.

## Phase 7 — LSP and diagnostics

Plugins may declare LSP servers. Dex should consume diagnostics rather than trying to infer every type/syntax issue from raw text.

Start with:

- TypeScript/JavaScript language server;
- ESLint where configured;
- CSS/SCSS diagnostics;
- JSON/YAML diagnostics.

Expose diagnostics as structured tools and as a persistent Problems panel in the UI.

## Phase 8 — Plugin marketplaces

Implement a local marketplace registry inspired by Claude Code:

```text
marketplaces.json
plugins.lock.json
```

Marketplace sources may be:

- GitHub repository;
- Git URL;
- local directory;
- HTTPS manifest URL.

Before installation display:

- publisher/source;
- version;
- requested MCP servers;
- requested hooks/executables;
- requested filesystem/network permissions;
- package hash/signature if available.

Prefer a curated Carlos marketplace over arbitrary auto-installation. Third-party plugins should never silently execute code because a model suggested installing them.

## Phase 9 — Interactive coding UI

Add a dedicated **Code** surface to Carlos Office:

- project/repository selector;
- session history;
- transcript with tool events;
- file-change/diff panel;
- permission cards;
- active subagents/worktrees;
- Problems/checks panel;
- plugin/skill indicators;
- model/context usage;
- stop/continue/revert controls.

The Office Map can show Dex coding sessions and technical subagents as live nodes using the same activity model already used for jobs.

## Phase 10 — Context management

A Claude Code-class coding agent cannot simply keep appending files to the prompt.

Implement:

1. repository map/index;
2. symbol/file retrieval;
3. conversation/session compaction;
4. preservation of current plan, open edits, failures and acceptance criteria during compaction;
5. retrieval of durable technical memory separately from transient session history;
6. automatic eviction of obsolete tool output;
7. explicit context-budget diagnostics.

Do not use Obsidian memory as a substitute for current repository state.

## Phase 11 — GitHub workflow

Once the local implementation loop is stable, enable scoped GitHub operations:

- read issue/PR context;
- create branch/worktree;
- stage selected files;
- draft commit message;
- show diff and validation;
- request Carlos approval;
- commit;
- request separate approval before push/PR/merge where desired.

Keep GitHub MCP behind a scoped PAT and policy rules. Do not make remote mutation a prerequisite for local coding.

## Phase 12 — Model routing

Dex should remain model-agnostic.

- MiniMax M3 cloud remains the normal Carlos Office primary model unless Carlos changes it.
- Qwen local fallback remains for connectivity failures.
- Plugins/skills may request capabilities, not silently force expensive models.
- Allow session-level model override.
- Add task-aware routing later: cheap model for repository mapping/formatting, stronger model for implementation/review when useful.
- Track model used, latency, failures and estimated cost per coding session.

## Recommended implementation order

1. Permission engine + checkpoints.
2. Dex session model + interactive Code UI.
3. Structured command/test/git layer.
4. Skills.
5. Hooks.
6. Worktree subagents.
7. LSP diagnostics.
8. Plugin manifest/install lifecycle.
9. Claude plugin compatibility importer.
10. Marketplace/lockfile/update system.
11. Approved GitHub commit/push/PR workflow.
12. Advanced context compaction and task-aware model routing.

## Definition of “Claude Code alternative” for Carlos

Dex is ready to replace Claude Code for Carlos's normal work when it can reliably:

- enter any allowed local repository;
- understand the codebase without manual file feeding;
- edit multiple files safely;
- run the project's normal checks;
- inspect UI behavior;
- recover/revert failed changes;
- resume sessions;
- load reusable skills;
- install and govern plugins;
- connect arbitrary MCP integrations;
- use isolated subagents/worktrees;
- present permission requests before high-impact operations;
- produce an auditable diff and test record;
- pass Vera verification and Nora final approval;
- work with Carlos Office's configured primary model and local fallback.

That target is achievable without recreating Claude Code's entire product. The key is to copy the architectural primitives—permissions, skills, hooks, subagents, MCP, plugins, session/context management—and integrate them into Carlos Office's existing orchestration and memory model.
