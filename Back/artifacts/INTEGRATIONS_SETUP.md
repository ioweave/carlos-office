# Carlos Office connected integrations setup

**Status:** current setup reference  
**Authority:** live `.env.example`, MCP configuration, and runtime tool discovery override this document if they change.

## 1. Pull and install

Carlos Office requires **Node.js 22.12 or newer**.

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

Create a Google Cloud OAuth 2.0 Desktop application client, enable the Workspace APIs you intend to use, and add to `Back/.env`:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_WORKSPACE_EMAIL=you@example.com
```

Restart the backend. In Nora, first inspect the integration:

```text
List the configured MCP servers. For google-workspace, discover its tools and tell me whether my account is authenticated. Do not send, delete, share, or modify anything.
```

OAuth tokens are managed by the MCP server, not written into Carlos Office memory.

## 3. Browser MCP

Install the Browser MCP Chrome extension, open the tab you want an agent to use, and connect the tab.

The default MCP catalog launches:

```text
npx -y @browsermcp/mcp@latest
```

`BROWSER_MCP_EXTENSION_KEY` remains an optional environment field for extension/build variants that require it.

State-changing browser interactions remain blocked by default. Enable only when explicitly required:

```env
BROWSER_MCP_ALLOW_INTERACTION=true
```

Playwright remains the deterministic local UI verification mechanism; Browser MCP is for the real authenticated browser context.

## 4. Gmail and calendar monitoring

With Google credentials and `GOOGLE_WORKSPACE_EMAIL` configured, the example monitor configuration checks Gmail triage and calendar agenda on their configured schedules.

Customize by copying:

```powershell
Copy-Item mcp.monitors.example.json mcp.monitors.json
```

`mcp.monitors.json` is ignored by Git. Monitor snapshots follow the retention/storage policy described in `RETENTION_ARCHITECTURE.md`.

Any configured MCP read tool can later become a monitor for support queues, CRM activity, issue trackers, Slack/Teams, or internal systems.

## 5. MCP configuration

The repository ships `Back/mcp.config.example.json`. To customize it:

```powershell
Copy-Item mcp.config.example.json mcp.config.json
```

The local file is ignored by Git.

Every server can define narrow agent access, for example:

```json
{
  "allowedAgents": ["nora", "iris"],
  "writeAgents": ["nora"]
}
```

Agents discover a server with `mcp_list_servers`, discover live tool schemas with `mcp_list_tools`, then invoke a selected tool through `mcp_call`. The proxy design keeps third-party tool schemas out of the base model context until needed.

## 6. High-impact actions

Default:

```env
MCP_ALLOW_DANGEROUS_ACTIONS=false
```

This blocks operations classified as high impact, such as mail send/reply/forward/trash, calendar mutations, remote deletion/sharing/permission changes, browser submissions/interactions, and common Git/deployment mutations.

For a period where Carlos explicitly wants such actions available:

```env
MCP_ALLOW_DANGEROUS_ACTIONS=true
```

Turn it off again when the workflow finishes. Browser interaction has its own narrower switch.

## 7. Local source-change authority

Nora and Dex can edit recognized source/text files and run allowlisted checks inside the repository. The current authenticated request is converted into a scoped authority capsule: deletion must be explicitly requested, necessary dependency installation follows implementation/install requests, and Git commit/push must be explicitly named. Nora must not ask Carlos to approve the same action twice.

Broad npm scripts and deploy/release commands retain independent environment gates:

```env
DEX_ALLOW_ARBITRARY_NPM_SCRIPTS=false
DEX_ALLOW_DEPLOY_COMMANDS=false
```

## 8. GitHub MCP

The example profile for GitHub's official MCP server is disabled by default. Configure Docker/runtime requirements plus a least-privilege token, enable the profile in local `mcp.config.json`, and set the required token/toolset environment variables.

Remote mutation should remain separately permission-gated. A local Git command such as `git show` does not replace fetching remote PR/issue context through GitHub MCP/API.

## 9. Adding another MCP

Add a stdio or Streamable HTTP server to `mcp.config.json` and give it the narrowest practical `allowedAgents`/write policy.

Potential integrations include Notion, Slack/Teams, Figma, Sentry, Linear/Jira, Cloudflare, Vercel, HubSpot, analytics systems and internal APIs. Prefer official/vendor servers and inspect requested scopes/tools before enabling them.

## 10. First validation prompts

### Nora

```text
Audit your live capability manifest. List each connected MCP server, the tools available to you, current monitors, and every worker. Explain which external operations are currently blocked by policy.
```

### Iris

```text
Discover your MCP integrations. Explain which of them are read-only for you. Then research one current public topic using at least two primary sources and save source notes in your own workspace.
```

### Dex

```text
Inspect the current repository, show git status, read the frontend engineering conventions from memory, and explain which source-write, check, deletion, dependency-install, browser and Git capabilities you have. Do not modify anything.
```

### Vera

```text
List the verification tools you can use and the mutation tools you are denied. Confirm that you can independently inspect repository source, run bounded checks, inspect the UI, read MCP data, and cannot edit source or connected business systems.
```
