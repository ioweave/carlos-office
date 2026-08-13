# Dex as a personalized Claude Code alternative

**Status:** canonical roadmap; skill ingestion and managed OpenMontage foundation implemented
**Scope:** Carlos Office / Dex  
**Rule:** revise this artifact when the roadmap changes; do not create parallel Dex roadmaps without explicitly superseding this file.

## Goal

Turn Dex from a delegated development worker into Carlos's local, model-agnostic coding environment: repository-aware, editable, testable, extensible through skills/plugins/MCP, safe by default, resumable, and integrated with Nora/Vera rather than operating as an isolated terminal agent.

This should not be a literal Claude Code clone. Carlos Office already has its own strengths: Nora orchestration, Vera acceptance, promotion-based memory/knowledge, Office Map workflow visibility, local-first storage, MiniMax M3 cloud routing, and a local Ollama fallback.

## Source-of-truth note

This roadmap describes intended architecture. Current source code and executable validation contracts remain authoritative for what Dex can do **today**.

Any future planning job about Dex must:

1. read this file;
2. inspect the current Dex tools/configuration;
3. compare the current implementation with this roadmap;
4. propose an amendment or next phase rather than starting over.

## Current Dex baseline

Dex currently has an explicit, CI-enforced tool allowlist. The capability validator now compares the complete supplied tool set with an approved set rather than merely checking that a few required tools exist.

Current capabilities include:

- repository list/read/search;
- atomic text/source writes with optional stale-read SHA guards;
- source deletion only when the current authenticated request explicitly asks for deletion/cleanup;
- bounded Node syntax checks;
- Git status/diff/log/show inspection;
- allowlisted npm scripts;
- dependency installation when it is necessary for an explicitly requested implementation/install task;
- deploy/release scripts behind a separate gate;
- Playwright DOM inspection, overflow/accessibility heuristics, screenshots, console/page **errors**, failed requests, and bounded interaction;
- Browser MCP when configured;
- generic MCP server/tool discovery and invocation;
- optional GitHub MCP when configured;
- local workspace files and Dex memory;
- Vera independent verification;
- Nora final plan approval.
- exact-path commit/push after Vera and Nora approval when the originating request explicitly asks for publication.

## Delivered foundation (2026-08-09)

The first reusable-capability milestone is now live and covered by executable validation contracts:

- a validated `Back/skills/<name>/SKILL.md` registry with progressive metadata/body disclosure;
- Nora/Dex/Iris skill list, read, install, and governed removal tools within their role allowlists;
- safe local-directory and GitHub skill ingestion with bounded size, path, and symlink checks;
- a managed external-project boundary outside the Carlos Office repository;
- OpenMontage clone/dependency setup, preflight, bounded reads, approved execution, execution receipts, artifact discovery, and media probing;
- one shared job for a delegated request, with collaborators contributing inside that job, Vera verification, Nora approval, and compact overwrite-style receipts;
- inline `artifact://` links whose previews survive job cleanup when the chat is saved.

This does not complete the later generic plugin, hook, interactive Dex session, marketplace, or compatibility-importer phases below.

### Important precision

Current Playwright diagnostics are useful but are **not** a complete DevTools replacement. They capture console/page errors and failed requests, not a full console transcript or complete request/response network timeline.

Current Git tools are local repository operations. `git show` is not a substitute for retrieving an arbitrary remote GitHub pull request; a real PR-review workflow should use GitHub MCP/API data plus local repository evidence when available.

## What Claude Code patterns are worth adopting

Current Claude Code documentation provides several architectural patterns worth reproducing in Carlos Office:

1. project instructions and reusable `SKILL.md` packages;
2. progressive disclosure of skill descriptions vs. full skill bodies;
3. explicit permission decisions;
4. resumable sessions and checkpoints;
5. specialized subagents with bounded tool/model scopes;
6. lifecycle hooks, including `PreToolUse` hooks that can deny a call;
7. MCP integrations;
8. plugins that bundle skills/agents/hooks/MCP and related components;
9. worktree isolation for parallel coding;
10. context compaction and repository-aware retrieval.

Carlos Office should adopt the primitives, not blindly copy Claude Code product behavior.

## Security model for future hooks

The central Carlos Office permission engine remains authoritative.

```text
central permission policy
        ↓
allow / ask / deny
        ↓
PreTool hook may impose an additional DENY
        ↓
tool executes only if all required gates permit it
```

A hook may **never grant** authority denied by the central permission engine. A hook may reject an otherwise permitted call for project-specific safety or quality reasons.

That preserves a single privilege boundary while still allowing deterministic project rules.

## Target architecture

```text
Carlos
  │
  ├── Interactive Dex coding session
  │      ├── Session/checkpoint manager
  │      ├── Repository/context manager
  │      ├── Skill resolver
  │      ├── Plugin registry
  │      ├── Permission engine
  │      ├── Tool/MCP router
  │      ├── Hook lifecycle
  │      ├── Git/worktree manager
  │      ├── Test/LSP diagnostics
  │      └── Artifact/diff presenter
  │
  └── Nora plan → Dex job → Vera verification → Nora approval
```

Interactive Dex and delegated Dex jobs should share the same execution, skill, plugin, permission, repository, and verification services. Interactive skill invocation should **not** require creating a Nora job; a delegated Nora job may invoke the same skill subsystem through the shared Dex executor.

---

# Phase 0 — governance, permission contract, and checkpoints

Do this before expanding Dex's authoring surface.

## Build

- central `DexPermissions` policy with `allow`, `ask`, `allow-session`, `allow-project`, and `deny` decisions;
- explicit tool/action/path/network dimensions;
- before-write checkpoints with file hashes/content snapshots;
- restore/revert capability;
- exhaustive CI capability allowlists;
- audit records for permission decisions and future skill/hook/plugin activation.

## Acceptance

- adding any new Dex tool fails CI until it is explicitly added to the approved allowlist;
- source mutations create a restorable checkpoint;
- a denied permission cannot be elevated by a skill, hook, subagent, plugin, or MCP server;
- `.env`, credentials, build output, dependencies, and out-of-root paths remain blocked.

---

# Phase 1 — interactive Dex sessions and Code UI

Create a dedicated `Back/src/dex/` domain instead of continuing to grow generic helpers.

Suggested components:

- `DexSession.mjs` — open/resume/continue/cancel session lifecycle;
- `DexContext.mjs` — repository map, retrieval, context budgeting and compaction;
- `DexExecutor.mjs` — structured model/tool loop;
- `DexPermissions.mjs` — central policy evaluator;
- `DexGit.mjs` — local Git/worktree primitives;
- `DexCheckpoints.mjs` — reversible source mutations.

Add a **Code** surface with:

- repository/project selector;
- resumable sessions;
- transcript + visible tool events;
- changed-file/diff panel;
- permission cards;
- checks/problems panel;
- stop/continue/revert controls;
- model/context diagnostics;
- active skills/plugins/subagents.

## Acceptance

Dex can take a repository issue from investigation through implementation and a verified local diff without Carlos manually feeding files through chat.

---

# Phase 2 — skills (foundation implemented)

Adopt the Agent Skills convention rather than inventing an unrelated prompt format.

Suggested layout:

```text
Back/skills/
  summarize-changes/
    SKILL.md
  review-pr/
    SKILL.md
  run-check/
    SKILL.md
```

Repository-local universal skill ingestion is implemented. Its canonical descriptor, content-addressed resource, provenance, governance, and four-repository validation contract is maintained in `UNIVERSAL_SKILL_DESCRIPTOR.md`. User-level skill layers and the starter skill catalog remain follow-on work.

Each canonical skill manifest/body declares at least:

- `name`;
- `description` / activation criteria;
- source and commit provenance;
- required tools/capabilities as non-authoritative hints;
- supporting references/scripts through a hashed resource manifest;
- safety, failure, and validation criteria.

Only skill metadata is loaded for discovery; the full descriptor is loaded on activation, and supporting files are retrieved in bounded chunks only when needed.

## Starter skills

- `/summarize-changes` — local Git diff summary and risk flags;
- `/review-pr` — fetch remote PR metadata/diff through GitHub MCP/API, then review against local conventions/source;
- `/run-check` — select and run an appropriate bounded project check;
- `/plan-implementation` — reconcile existing artifacts/source and produce a bounded plan before writes;
- `/format-frontend` — BEM/mobile-first frontend review;
- `/inspect-component` — Playwright component/UI inspection;
- `/dependency-audit` — inspect package metadata and configured dependency information without silently installing;
- `/commit-message` — draft from the staged/current diff; no commit side effect.

## Invocation architecture

```text
Carlos → interactive Dex session → Skill Resolver → DexExecutor
Nora   → delegated Dex job      → Skill Resolver → DexExecutor
```

The skill subsystem is shared; delegation is not a prerequisite for interactive invocation.

## Acceptance

- malformed skill definitions fail a clear validator without crashing the runtime;
- a skill cannot request tools outside the invoking agent's approved set;
- activation is auditable;
- skill instructions remain concise/procedural and load on demand.

---

# Phase 3 — hooks

Add deterministic lifecycle handlers around the central permission/tool layer.

Initial events should include:

- `SessionStart` / `SessionEnd`;
- `BeforeModel`;
- `PreToolUse`;
- `PostToolUse`;
- `ToolError`;
- `BeforeWrite` / `AfterWrite`;
- `BeforeCheck` / `AfterCheck`;
- `BeforeJobAcceptance`.

Useful built-ins:

- syntax/check trigger after relevant source edits;
- formatter/lint/check when configured;
- BEM/mobile-first audit reminder after frontend style edits;
- checkpoint before mutation;
- project-specific deny rules.

## Hook governance

- hooks can observe, add context, run bounded approved automation, or **deny** an otherwise eligible operation;
- hooks cannot grant permissions denied by the central policy;
- executable hook commands use explicit allowlists, project-root containment, no shell expansion, timeout caps, and audit events;
- plugin-provided hooks are untrusted until enabled/approved.

---

# Phase 4 — bounded technical subagents and worktrees

Support file-defined ephemeral technical subagents scoped to Dex work.

Useful built-ins:

- explorer — read-only repository tracing;
- reviewer — read-only diff/code review;
- UI verifier — Playwright/screenshot verification;
- test agent — checks/diagnostics;
- implementation agent — scoped writes only when explicitly allowed.

A subagent's tool set must be a subset of Dex's currently approved authority. There is no privilege escalation through nested agents.

Parallel write-capable work should use isolated Git worktrees and merge only after conflict detection and Vera/Nora acceptance.

---

# Phase 5 — plugin system

Use a Carlos Office plugin format compatible in spirit with Claude Code rather than pretending the products are identical.

Proposed structure:

```text
plugins/<plugin>/
  .carlos-plugin/
    plugin.json
  skills/
  agents/
  hooks/
  mcp.json
  lsp.json
  monitors/
  bin/
```

The plugin lifecycle should support:

- discover;
- inspect manifest/provenance;
- install;
- enable/disable globally or per project;
- requested-permission review;
- update;
- rollback;
- uninstall;
- version/hash lockfile.

No plugin receives new authority merely because it requests it.

A later compatibility importer may translate compatible Claude Code plugin components (`skills/`, agents, hooks, `.mcp.json`) where semantics genuinely match.

---

# Phase 6 — LSP and structured diagnostics

Add structured diagnostics instead of forcing the model to infer every issue from raw files.

Start with the project's configured tooling:

- TypeScript/JavaScript diagnostics;
- ESLint when installed;
- CSS/SCSS diagnostics;
- JSON/YAML diagnostics.

Expose problems as structured Dex tools and in the Code UI.

---

# Phase 7 — context management

A Claude Code-class coding agent cannot continuously append raw files/tool output to the context window.

Implement:

1. repository map/index;
2. symbol/file retrieval;
3. session compaction;
4. preservation of current plan, open edits, failures and acceptance criteria during compaction;
5. durable Dex memory separated from transient session history;
6. eviction of obsolete tool output;
7. explicit context-budget diagnostics.

Do not use Obsidian memory as a substitute for current repository state.

---

# Phase 8 — GitHub workflow

Once the local coding loop is reliable:

- retrieve issue/PR context through GitHub MCP/API;
- create local branch/worktree;
- stage selected files;
- draft commit message;
- show diff + validation;
- request Carlos approval where configured;
- commit;
- separately gate push/PR/merge according to policy.

Remote mutation remains optional and permission-scoped.

---

# Phase 9 — plugin marketplace and model routing

After the plugin lifecycle is stable, add curated marketplace/lockfile support. Marketplace installation must expose provenance, version, requested MCP servers/hooks/executables, filesystem/network permissions, and hashes before enablement.

Dex remains model-agnostic:

- MiniMax M3 cloud remains the default unless Carlos changes configuration;
- local Ollama fallback remains available for connectivity failures;
- session-level model overrides may be supported;
- skills/plugins request capabilities, not silently force expensive models;
- task-aware routing can come later with observable latency/failure/cost metrics.

---

## Recommended implementation order

1. central permission contract + checkpoints;
2. resumable Dex sessions + Code UI;
3. structured command/test/Git services;
4. skills;
5. hooks;
6. worktree subagents;
7. LSP diagnostics;
8. plugin manifest/install lifecycle;
9. Claude plugin compatibility importer;
10. marketplace/lockfile/update system;
11. approved GitHub commit/push/PR workflow;
12. advanced context compaction and task-aware routing.

## Definition of "Claude Code alternative" for Carlos

Dex is ready to replace Claude Code for Carlos's normal work when it can reliably:

- enter any allowed local repository;
- understand the codebase without manual file feeding;
- safely edit multiple files;
- run the project's normal checks;
- inspect UI behavior;
- recover/revert failed changes;
- resume coding sessions;
- load reusable skills;
- install/govern plugins;
- connect scoped MCP integrations;
- use isolated technical subagents/worktrees;
- present permission requests before high-impact operations;
- produce an auditable diff/check record;
- pass Vera verification and Nora final approval;
- operate with Carlos Office's configured model routing.

The goal is not feature-for-feature product parity. The goal is to adopt the strongest coding-agent primitives and integrate them cleanly into Carlos Office's existing orchestration, retention, permission, artifact, and verification architecture.

## External references used for this roadmap

Current Claude Code documentation should be rechecked whenever a parity claim materially affects implementation:

- `https://code.claude.com/docs/en/skills`
- `https://code.claude.com/docs/en/sub-agents`
- `https://code.claude.com/docs/en/hooks`
- `https://code.claude.com/docs/en/plugins`
