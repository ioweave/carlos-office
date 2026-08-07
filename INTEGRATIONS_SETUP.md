# Carlos Office Connected Integrations Setup

## 1. Pull and install

The current Google Workspace MCP release requires **Node.js 22.12 or newer**, so Carlos Office now uses the same minimum backend runtime.

```powershell
node --version
cd C:\path\to\carlos-office
git pull origin main
cd Back
npm install
npm run validate:capabilities
```

If `node --version` is older than `v22.12.0`, upgrade Node before starting the backend.

## 2. Google Workspace

Carlos Office uses the configured Google Workspace MCP server for Gmail, Calendar, Drive, Docs, Sheets and related Workspace APIs.

Create a Google Cloud OAuth 2.0 **Desktop application** client and enable the Workspace APIs you intend to use. Add to `Back/.env`:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_WORKSPACE_EMAIL=you@example.com
```

Restart the backend. In Nora, first inspect the integration:

```text
List the configured MCP servers. For google-workspace, discover its tools and tell me whether my account is authenticated. Do not send, delete, share, or modify anything.
```

If account authentication is required, either authenticate through the Google Workspace MCP server manually or temporarily authorize the account-authentication action under your chosen policy. OAuth tokens are managed by the MCP server in the user's configuration/data directories, not in the Carlos Office vault.

## 3. Browser MCP

Install the Browser MCP Chrome extension, open the tab you want an agent to use, and click **Connect** in the extension.

The default MCP catalog launches:

```text
npx -y @browsermcp/mcp@latest
```

The current Browser MCP setup normally does not require an extension key. `BROWSER_MCP_EXTENSION_KEY` is retained as an optional environment field for extension/build variants that require one.

By default browser state-changing interactions remain blocked. To allow Carlos Office agents with Browser MCP write authority to click/fill/submit in the connected tab:

```env
BROWSER_MCP_ALLOW_INTERACTION=true
```

Only enable that when you want agents to take browser actions rather than merely inspect the page.

## 4. Gmail and calendar monitoring

With Google credentials and `GOOGLE_WORKSPACE_EMAIL` configured, the example monitor configuration checks:

- Gmail triage every 5 minutes;
- calendar agenda every 15 minutes.

Snapshots are stored locally under:

```text
50-Monitors/gmail-inbox/latest.md
50-Monitors/calendar-agenda/latest.md
```

Customize by copying:

```powershell
Copy-Item mcp.monitors.example.json mcp.monitors.json
```

`mcp.monitors.json` is ignored by Git.

Any configured MCP read tool can become a monitor, so the same mechanism can later watch Slack, support queues, CRM activity, issue trackers or internal APIs.

## 5. MCP configuration

The repository ships `Back/mcp.config.example.json`. Carlos Office uses it as the default catalog. To customize it:

```powershell
Copy-Item mcp.config.example.json mcp.config.json
```

The local file is ignored by Git.

Every server can define:

```json
{
  "allowedAgents": ["nora", "iris"],
  "writeAgents": ["nora"]
}
```

Agents discover a server with `mcp_list_servers`, discover its live tool schemas with `mcp_list_tools`, then invoke a selected tool through `mcp_call`. This proxy design avoids injecting hundreds of third-party tools into every model prompt.

## 6. High-impact actions

The default is:

```env
MCP_ALLOW_DANGEROUS_ACTIONS=false
```

This blocks operations classified as high impact, including email send/reply/forward/trash, calendar mutations, remote deletion/sharing/permission changes, browser form interactions and common Git/deployment mutations.

For a period where Carlos explicitly wants those actions available:

```env
MCP_ALLOW_DANGEROUS_ACTIONS=true
```

Turn it off again when the workflow is finished. Browser interaction has its own narrower switch, `BROWSER_MCP_ALLOW_INTERACTION`.

## 7. Dex source-change gates

Dex can edit normal source/text files and run allowlisted checks by default. These remain off:

```env
DEX_ALLOW_PROJECT_DELETE=false
DEX_ALLOW_DEPENDENCY_INSTALL=false
DEX_ALLOW_DEPLOY_COMMANDS=false
```

Enable only the specific authority needed for the current work.

## 8. GitHub MCP

The example profile for GitHub's official MCP server is disabled by default. To use it, configure Docker plus a least-privilege token, edit `mcp.config.json` to enable the profile, and set:

```env
GITHUB_PERSONAL_ACCESS_TOKEN=...
GITHUB_TOOLSETS=context,repos,issues,pull_requests,actions
```

Iris and Vera remain read-only under the supplied policy; Dex/Nora may receive write policy, but high-impact remote actions remain subject to the global gate.

## 9. Adding another MCP

Add any stdio or Streamable HTTP server to `mcp.config.json`. Give it the narrowest `allowedAgents` and `writeAgents` lists that fit the job.

Good candidates when needed include Notion, Slack/Teams, Figma, Sentry, Linear/Jira, Cloudflare, Vercel, HubSpot, analytics systems and private internal APIs. Prefer vendor/official servers, inspect their requested scopes and tools before enabling them, and do not expose an integration to every agent by default.

## 10. First validation prompts

### Nora

```text
Audit your live capability manifest. List each connected MCP server, the tools available to you, current monitors, and every worker. Explain which external operations are currently blocked by policy.
```

### Iris

```text
Discover your MCP integrations. Explain which of them are read-only for you. Then research one current public topic using at least two primary sources and save the source notes in your own office workspace.
```

### Dex

```text
Inspect the current repository, show git status, read the frontend engineering conventions from memory, and explain which source-write, check, deletion, dependency-install, browser and Git capabilities you have. Do not modify anything.
```

### Vera

```text
List the verification tools you can use and the mutation tools you are denied. Confirm that you can independently inspect repository source, run bounded checks, inspect the UI, read MCP data, and cannot edit source or connected business systems.
```
