# Carlos Office agent capability audit

**Status:** current reference  
**Authority:** live tool registries + `Back/scripts/validate-agent-capabilities.mjs` override this document if implementation changes.

## Operating model

Carlos Office uses a real-office authority model rather than giving every agent every tool.

`Carlos → Nora plan → worker execution → Vera verification → Nora final approval → Carlos`

If Vera rejects an iteration, the worker receives Vera's objective correction. If Vera passes but Nora determines that the result still misses the original plan, Nora sends it back for another bounded iteration. Jobs become `completed` only after Nora's final approval. Exhausted revision budgets become explicit `needs_attention` states with `waitingOn`/reason metadata.

## Capability contract

`validate-agent-capabilities.mjs` is now an **exhaustive role contract**, not merely a required-tool smoke test. For every agent, the validator compares the actual supplied tool names against an explicit approved allowlist. Adding or removing a tool therefore fails CI until the role authority change is intentionally reviewed and the approved set is updated.

This contract is separate from MCP action classification. An agent may possess `mcp_call`, while the MCP gateway still independently classifies individual operations as read/write/dangerous and applies server/agent/action policy.

## Shared capability layers

All agents receive permanent knowledge search, public web search/fetch, current time, a scoped local working-file area, monitor reads, and governed MCP discovery/calls according to their role.

Configured MCP integrations are discovered lazily through `mcp_list_servers` and `mcp_list_tools`; third-party schemas are not dumped into every model prompt.

High-impact external actions remain disabled unless Carlos explicitly enables the corresponding policy gate. MCP calls are audited with secret-like fields redacted.

## Agent matrix

| Agent | Real-world analogue | Primary operational capabilities | Connected-service authority |
| --- | --- | --- | --- |
| Nora | Chief of Staff / operations manager | planning, source-of-truth reconciliation, delegation, job control, final approval, compact fact memory, knowledge governance, agent runtime configuration, monitors, research, browser inspection | Google Workspace read/write where policy permits; Browser MCP; dangerous external actions separately gated |
| Marco | Commercial strategist / BD lead | market research, competitor analysis, offers, proposals, account briefs, outreach drafts, commercial working files | Google Drive/Gmail/Calendar through MCP; working-document updates where permitted; send/delete/share remain gated |
| Luma | Creative director | brand/campaign strategy, scripts, storyboards, copy, creative briefs, localization, asset requirements | Google Workspace working docs/Drive and browser context; publishing/destructive actions remain gated |
| Dex | Software engineer / automation lead | repository read/search/write, safe source changes, bounded checks, Git inspection, Playwright, Browser MCP, optional GitHub MCP | local source writes enabled; deletion/install/deploy/remote Git mutations separately gated |
| Iris | Research/intelligence analyst + librarian | public research, primary-source verification, authenticated research, source ingestion, project/universal knowledge hygiene | Google Workspace primarily read-oriented plus permitted working files; no independent universal promotion or destructive retention |
| Vera | independent QA / acceptance | repository reads, independent checks, Playwright verification, web/source verification, MCP reads, monitor reads | read-only connected-service policy; no project or external-system mutation |

## Source-of-truth discipline

For current implementation questions:

1. live source/runtime manifest;
2. executable validators;
3. durable project artifacts under `Back/artifacts`;
4. retained memory/knowledge;
5. old chats/job receipts.

Before planning an existing Carlos Office capability, Nora/workers must inspect the artifact index and reconcile relevant existing plans with current source. Vera must reject a planning deliverable that creates a parallel roadmap while ignoring an existing canonical artifact.

Material capability claims must match the actual implementation. Examples:

- a `requireTools(...)`-style assertion alone is not an exhaustive allowlist; the current validator uses exact set equality;
- Playwright captures console/page **errors** and failed requests, not a complete console/network trace;
- local `git show` cannot retrieve an arbitrary remote pull request; PR workflows require GitHub MCP/API context.

## Scenario simulations

### Nora — project planning and delegation

1. Search retained decisions relevant to the objective.
2. Inspect `Back/artifacts/README.md` and the relevant canonical project artifact.
3. Inspect live source/configuration that can verify the artifact assumptions.
4. Reconcile the current plan instead of creating a duplicate.
5. Delegate bounded worker jobs with objective acceptance criteria.
6. Vera independently verifies the result.
7. Nora performs final plan approval or returns precise revision feedback.
8. Remember only stable facts/decisions likely to matter across sessions—not current-conversation state.

Pass condition: Nora does not say something was saved/remembered unless the corresponding tool succeeded, and does not retain statements such as “Carlos will review this plan later.”

### Marco — commercial opportunity

Prompt: "Research a prospective client's market, compare five competitors, draft a positioning memo and an outreach email, and save the memo to the working Drive folder."

Expected pattern: retained-context search → public/authenticated research → permitted Drive/document reads/updates → local draft/output → no email send without the dangerous-action gate.

### Luma — campaign production brief

Prompt: "Review current brand material, build a localized campaign concept, produce a script/storyboard brief, and update the shared creative working document."

Expected pattern: brand/project context → research/references → working document/artifacts → no publishing or destructive external action.

### Dex — feature implementation

Prompt: "Inspect the bug, implement the smallest fix, run syntax/build/UI checks, and return the diff for review."

Expected pattern: repository list/read/search → atomic source writes → bounded checks/diff → Playwright where relevant → no deletion/install/deploy/remote mutation unless separately enabled.

### Iris — evidence-backed research and ingestion

Prompt: "Investigate current approaches, verify claims from primary sources, compare them with internal material, and produce a sourced brief."

Expected pattern: current web evidence + relevant internal sources → fact/source/inference separation → project knowledge or universal proposal according to lifecycle → no silent universal promotion.

### Vera — independent acceptance

Vera must verify explicit criteria and material claims using read/check tools. For plans/audits, she additionally checks source-of-truth reconciliation and the semantics of named tools/validators. She does not rewrite the job and does not demand optional polish after mandatory criteria are satisfied.

## Integrations

### Google Workspace

The configured Google Workspace MCP profile supports Gmail, Calendar, Drive, Docs, Sheets and related Workspace operations subject to OAuth and Carlos Office policy.

### Browser MCP

Browser MCP can use the real logged-in browser session when the extension/tab is connected. State-changing browser actions remain separately gated.

### GitHub MCP

The optional GitHub MCP profile is disabled by default and should use a least-privilege token/toolset. Remote mutations remain subject to explicit policy.

### Filesystem MCP

The optional filesystem MCP profile remains disabled by default because native project/workspace tools provide narrower controls. Enable it only for additional directories that genuinely require it.

## Security boundaries

- environment secrets are not exposed as model tools;
- agent tool surfaces are exact CI-reviewed allowlists;
- MCP servers have per-agent access policy and action classification;
- dangerous external actions are disabled by default;
- Vera is deliberately non-mutating;
- Dex deletion, dependency install and deploy/release commands have independent gates;
- native workspace/project paths cannot escape their configured roots;
- worker/tool success is not equivalent to Vera acceptance or Nora approval.
