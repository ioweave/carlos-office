# Carlos Office project artifacts

This directory contains durable human-readable project artifacts: architecture records, capability audits, setup references, and canonical implementation roadmaps.

It is **not** a runtime output directory. Temporary plans, worker iterations, chat transcripts, screenshots, and job telemetry belong to their existing volatile/runtime lifecycles and should not be committed here merely because an agent produced them.

## Source-of-truth order

For questions about Carlos Office itself, use this order:

1. **Live source code and runtime configuration** — authoritative for what the system currently does.
2. **Executable validation contracts** under `Back/scripts/` — authoritative for the guarantees they explicitly assert.
3. **Canonical artifacts in this directory** — durable architecture/planning intent.
4. **Obsidian knowledge/memory** — useful retained context, but it may be stale.
5. **Old chats/job receipts** — historical evidence only; never proof of current behavior.

If a durable artifact conflicts with live implementation, report the conflict. Do not silently treat either as equivalent. Update/supersede the artifact when the implementation intentionally changes the architecture.

## Current artifacts

| Artifact | Status | Purpose |
| --- | --- | --- |
| `DEX_CLAUDE_CODE_PLAN.md` | **Canonical roadmap** | Source of truth for turning Dex into Carlos's Claude Code alternative. New Dex plans must reconcile with this file rather than creating a parallel roadmap. |
| `AGENT_CAPABILITY_AUDIT.md` | Current audit/reference | Role boundaries, real-life scenarios, connected-service authority, and capability governance. Live `toolRegistry`/`capabilityRegistry` plus `validate-agent-capabilities.mjs` override stale statements. |
| `RETENTION_ARCHITECTURE.md` | Architecture record | Promotion-based persistence, temporary chats/sources, remembered facts, knowledge lifecycles, compact job receipts, and cleanup rules. |
| `INTEGRATIONS_SETUP.md` | Setup reference | Google Workspace, Browser MCP, generic MCP, monitors, GitHub MCP, and local capability gates. |

## Planning preflight

Before Nora, Dex, Iris, or Vera creates/reviews a plan for this repository:

1. Read this index.
2. Identify the artifact most closely matching the objective.
3. Read that artifact.
4. Inspect the current source/configuration that can confirm or invalidate its assumptions.
5. Search for additional relevant specifications before proposing changes.
6. Produce a revision/reconciliation against the existing plan when one exists; do not create a duplicate plan without explicitly superseding the canonical artifact.

## Retention rule for repository artifacts

Keep an artifact here when Carlos could reasonably need to reopen it later as a project-level source of truth or reference. Delete obsolete generated prompts, one-off validation scripts in prose, superseded plans, and duplicate audit output once their useful rules are represented by current code/tests/documentation.
