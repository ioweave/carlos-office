# Carlos Office — Claude Code Instructions

## Read authorization

Carlos explicitly authorizes Claude Code to perform all non-mutating read and inspection operations required to understand this repository and complete an assigned task.

This authorization includes:

* inspecting repository structure;
* reading source code and documentation;
* examining symbols, references, imports, dependencies, and call relationships;
* viewing Git status, history, diffs, and metadata;
* inspecting configuration and package metadata;
* running non-mutating analysis commands.

This standing authorization applies only to read operations. It does not authorize file modification, deletion, external communication, deployment, credential access, or other side effects beyond the scope of the current request.

## Mandatory coding standard

`MANDATORY_CODING_STANDARD.md` is authoritative and mandatory.

Before analyzing, planning, generating, or modifying code, Claude Code must read the complete current version of `MANDATORY_CODING_STANDARD.md`.

All generated or modified code must comply with it. If another instruction, recommendation, convention, generated plan, or inferred best practice conflicts with that file, `MANDATORY_CODING_STANDARD.md` takes precedence unless Carlos explicitly overrides a specific rule.

Claude Code must not rewrite, reinterpret, weaken, or silently bypass the coding standard.

## Mandatory file structure

Claude Code must preserve and respect the repository structure defined by:

* the current repository tree;
* Sections 25 and 26 of `PROJECT_FUNCTIONAL_SPECIFICATION.md`;
* any more specific structural instruction given directly by Carlos.

Files must remain in the directories that own their responsibilities.

Claude Code must not move files, rename directories, introduce a replacement architecture, split `Back/src/config.mjs`, or create new structural layers unless Carlos explicitly authorizes the change.

The canonical live execution term is `Workflow`. New code must not introduce legacy `Job` terminology.

## Graphify-only repository reading

Graphify is mandatory for repository reading and codebase inspection.

Claude Code must always use Graphify for:

* reading file contents;
* locating files or symbols;
* searching the repository;
* inspecting imports and references;
* tracing dependencies and call relationships;
* understanding architecture;
* re-reading modified files;
* validating how a change affects the repository graph.

Claude Code must not substitute direct filesystem reading commands such as `cat`, `sed`, `head`, `tail`, `grep`, `rg`, or `find` for repository inspection.

Read-only Git metadata commands may be used where Graphify does not represent the required Git information.

If Graphify is unavailable, outdated, or returns an error, Claude Code must stop and report the problem. It must not silently fall back to another repository-reading method.

## Graphify batch cadence

Use Graphify to understand the relevant code before changing it. Make one coherent batch of related changes. Refresh Graphify after the coherent batch. Inspect the affected relationships once. Perform a final Graphify review before completion.

Do not turn a five-file refactor into twenty-five Graphify/update cycles. No per-write wait, per-write refresh, or per-write re-read is required.

Claude Code must never assume that Graphify immediately reflects a change.

## Scope discipline

If Carlos says BACKEND ONLY:

* `Front/` is out of scope;
* do not inspect it;
* do not build it;
* do not modify it.

If Carlos says FRONTEND ONLY:

* backend implementation is out of scope unless a specific backend dependency must be inspected.

## Minimalism

* solve only the requested problem;
* do not add future-proofing;
* do not add unrelated hardening;
* deletion is preferable to abstraction;
* direct code is preferable to reusable infrastructure used once;
* do not invent requirements.

## Compliance

Before presenting completed work, Claude Code must verify that:

* `MANDATORY_CODING_STANDARD.md` was followed;
* the established file structure was preserved;
* Graphify was used for repository reads;
* a final Graphify review of the affected dependency graph was performed;
* no unauthorized side effects were performed.