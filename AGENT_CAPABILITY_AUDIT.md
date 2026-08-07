# Carlos Office Agent Capability Audit

## Operating model

Carlos Office now uses a real-office authority model rather than giving every agent every tool.

`Carlos → Nora plan → worker execution → Vera verification → Nora final approval → Carlos`

If Vera rejects an iteration, the worker receives Vera's objective correction. If Vera passes but Nora determines that the result still misses the original plan, Nora sends the job back for another bounded iteration. Jobs only become `completed` after Nora's final approval.

## Shared capability layers

All agents receive permanent Obsidian memory, public web search/fetch, current time, a scoped local working-file area, and the governed MCP discovery/call gateway.

Configured MCP integrations are discovered lazily through `mcp_list_servers` and `mcp_list_tools`; individual third-party tools are not dumped into every model prompt. This keeps the tool context bounded while allowing any configured MCP server to be used.

Connected-service calls are audited under `90-System/Runtime/MCP`. High-impact external actions remain disabled unless Carlos explicitly enables the corresponding environment gate.

## Agent matrix

| Agent | Real-world analogue | Primary operational capabilities | Connected-service authority |
| --- | --- | --- | --- |
| Nora | Chief of Staff / operations manager | planning, delegation, job control, final approval, shared memory curation, agent runtime configuration, monitors, research, browser inspection | Google Workspace read/write where allowed; Browser MCP inspection; high-impact actions remain gated |
| Marco | Commercial strategist / BD lead | market research, competitor analysis, account briefs, offers, proposals, outreach drafts, commercial working files | Google Drive/Gmail/Calendar through MCP; may update working docs, but sending/deleting/sharing remains gated |
| Luma | Creative director | brand/campaign strategy, scripts, storyboards, copy, creative briefs, localization, asset requirements | Google Workspace working docs and Drive; browser context; publishing/destructive actions remain gated |
| Dex | Software engineer / automation lead | repository read/search/write, safe source changes, bounded tests/checks, git inspection, Playwright, Browser MCP, optional GitHub MCP | source writes enabled; deletion/install/deploy/remote Git mutations separately gated |
| Iris | Research/intelligence analyst | deep public research, primary-source verification, authenticated browser research, monitor snapshots, evidence briefs | Google Workspace primarily read-oriented; Browser MCP research; no message sending/sharing changes |
| Vera | QA / independent acceptance | repository reads, independent checks, Playwright verification, web/source verification, MCP reads, monitor reads | read-only connected-service policy; no source or external-system mutation |

## Scenario simulations

### Nora — morning operations and delegation

1. `monitor_list` identifies Gmail and calendar monitors.
2. `monitor_read` reads the latest inbox triage and agenda snapshots.
3. Nora groups actionable work and creates explicit jobs with expected results and acceptance criteria.
4. Workers execute independently.
5. Vera verifies against the plan using read/check tools.
6. Nora performs final plan approval; she either completes the job or sends a precise revision back.
7. Nora writes durable decisions to shared Obsidian memory.

Pass condition: no job is reported as complete solely because the worker finished or Vera passed it.

### Marco — commercial opportunity

Prompt: "Research a prospective client's market, compare five competitors, draft a positioning memo and an outreach email, and save the memo to the working Drive folder."

Expected tool pattern:
- memory search for company rules;
- web search/fetch and, when needed, Browser MCP;
- Google Workspace MCP Drive search/read/update;
- Gmail draft preparation or local draft file;
- no email send without the high-impact action gate.

### Luma — campaign production brief

Prompt: "Review the current brand material, build a localized campaign concept, produce a script/storyboard brief, and update the shared creative working document."

Expected tool pattern:
- memory for brand rules;
- public/browser research for references;
- Drive/Docs through Google Workspace MCP;
- own local workspace for drafts;
- no publication or destructive remote action.

### Dex — feature implementation

Prompt: "Inspect the bug, implement the smallest fix, run syntax/build/UI checks, and return the diff for review."

Expected tool pattern:
- repository list/read/search;
- `project_write_file` with a stale-write SHA guard when modifying an existing file;
- `project_run_check` for syntax/tests/build/git diff;
- Playwright for rendered local UI verification;
- optional GitHub MCP for issue/PR context;
- no project deletion, dependency installation, deployment, commit/push/merge unless Carlos separately enables those capabilities.

### Iris — evidence-backed research

Prompt: "Investigate three current approaches, verify the claims from primary sources, inspect the logged-in vendor dashboard if necessary, and produce a sourced brief."

Expected tool pattern:
- web search + fetch;
- Browser MCP for authenticated browser context;
- Google Workspace read access for relevant internal files/mail;
- monitor snapshots where useful;
- own workspace notes;
- explicit separation of fact, source claim, assumption, and inference.

### Vera — independent acceptance

Prompt context is a worker deliverable plus Nora's plan.

Expected tool pattern:
- only verification-oriented tools;
- repository reads and `project_run_check` for technical work;
- Playwright checks for UI work;
- web/MCP read operations for factual work;
- no source writes, Drive edits, mail sends, calendar mutation, sharing, or browser form submission;
- structured `pass|revise` JSON against explicit criteria only.

## External integrations

### Google Workspace

The default catalog includes `@aaronsb/google-workspace-mcp`, exposing Gmail, Calendar, Drive, Docs, Sheets and related Workspace operations. Authentication uses Google OAuth credentials from environment variables; account tokens are managed by the MCP server, not written to Carlos Office memory.

### Browser MCP

The default catalog includes `@browsermcp/mcp@latest`. The Chrome extension must be installed and the target tab connected. It uses the real logged-in browser session; Carlos Office's policy layer still decides which agent may invoke state-changing browser tools.

### GitHub MCP

An optional profile for GitHub's official MCP server is included but disabled by default. Enable it only after configuring Docker and a scoped PAT. Dex receives write policy only when the profile and external-action gate permit it; Iris/Vera remain read-only.

### Filesystem MCP

The official filesystem server profile is included but disabled because Carlos Office already has safer native workspace and repository tools. Enable it only for additional directories that cannot be represented through the native scoped tools.

### Additional MCPs

Any local stdio or Streamable HTTP MCP can be added to `Back/mcp.config.json` with an agent allowlist and write policy. Useful future categories include Notion, Slack/Teams, Figma, Sentry, Linear/Jira, Cloudflare, Vercel, HubSpot, CRM/accounting tools and internal APIs. Prefer official/vendor servers and minimum scopes. Do not add a server solely because it exists.

## Periodic monitoring

`Back/mcp.monitors.example.json` contains Gmail triage and calendar agenda monitors. When Google credentials and the account email are configured, the backend checks them periodically and stores the latest snapshots under `50-Monitors/` in Obsidian. Monitor state therefore remains inspectable and local.

## Security boundaries

- Environment secrets are never exposed as model tools.
- MCP calls are audited with secret-like argument fields redacted.
- MCP servers have per-agent allowlists and write allowlists.
- High-impact external actions are disabled globally by default.
- Vera is deliberately read-only for connected services.
- Dex source deletion, dependency installation and deploy/release commands each have independent environment gates.
- Agents cannot write arbitrary filesystem paths through the native workspace tools.
- Worker tool output remains subject to Vera and Nora review; tool success is not equivalent to job acceptance.
