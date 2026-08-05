# Carlos Office

Local-first operating interface for Mer1dian's agent team: Nora, Marco, Luma, and Dex.

The implementation intentionally mirrors the practical conventions in `carlos-platform`:

- JavaScript only: `.mjs` backend and `.jsx` frontend
- Node.js ESM
- Axios
- MongoDB/Mongoose
- React + Vite
- no login for local operation
- no agent framework
- no TypeScript
- no test suite in this initial scaffold

## What is included

- Carlos Platform-style local UI with dark/light themes
- Nora chat interface
- per-agent provider and model configuration
- Ollama-first local inference
- optional OpenAI, OpenAI-compatible, Claude, or Gemini provider selection
- opt-in cloud fallback per agent
- model changes applied on the next invocation without restarting
- MongoDB conversation persistence
- durable queued job records for delegated work
- shared tool registry used by agents and the MCP server
- public web search and safe URL fetching
- stdio MCP server for external MCP-compatible local clients

## Local architecture

```text
Browser (127.0.0.1:5173)
    -> Carlos Office API (127.0.0.1:3002)
        -> MongoDB
        -> Ollama (127.0.0.1:11434)
        -> optional cloud AI providers
        -> shared web/MCP tool registry
```

The API binds to `127.0.0.1` by default. Authentication is intentionally absent because this is a local-only application. Do not bind it to a public interface without adding authentication and authorization.

## Start locally

### 1. Prerequisites

- Node.js 20 or newer
- MongoDB
- Ollama

```bash
ollama serve
ollama pull qwen3:8b
```

Any installed Ollama model can be selected from the Agents screen.

### 2. Backend

```bash
cd Back
cp .env.example .env
npm install
npm run dev
```

Backend: `http://127.0.0.1:3002`

### 3. Frontend

```bash
cd Front
cp .env.example .env
npm install
npm run dev
```

UI: `http://127.0.0.1:5173`

## Model hot-swapping

Each agent stores its own runtime configuration in MongoDB:

- provider
- model
- base URL
- temperature
- maximum tool rounds
- optional fallback provider/model

Saving a change in the Agents screen affects the agent's next invocation. Existing queued jobs can retain their own provider snapshot when execution is implemented.

Ollama and OpenAI-compatible providers support the current tool loop. Claude and Gemini are available as text-generation hot-swap targets in this initial scaffold; native tool translation for those APIs can be added later without changing the tool registry.

Cloud fallback is disabled by default so local model failures cannot silently create costs.

## Web lookup tools

`web_search` chooses a provider in this order when `SEARCH_PROVIDER=auto`:

1. SearXNG when `SEARXNG_URL` exists
2. Brave Search when `BRAVE_SEARCH_API_KEY` exists
3. Tavily when `TAVILY_API_KEY` exists
4. DuckDuckGo HTML fallback

`fetch_url` extracts readable text from public HTTP/HTTPS pages. It blocks localhost, private IP ranges, link-local addresses, and cloud metadata hosts.

## MCP server

The same internal registry is exposed through a local stdio MCP server:

```bash
cd Back
npm run mcp
```

Available tools:

- `web_search`
- `fetch_url`
- `current_time`
- `list_ollama_models`
- `list_agents`
- `create_agent_job`

Example local MCP client configuration:

```json
{
  "mcpServers": {
    "carlos-office": {
      "command": "node",
      "args": ["--env-file=/absolute/path/to/carlos-office/Back/.env", "/absolute/path/to/carlos-office/Back/src/mcp/server.mjs"]
    }
  }
}
```

The MCP server writes protocol data to stdout and operational messages to stderr.

## Current boundary

This commit provides the office interface, model runtime, persistence, web research tools, shared MCP tools, and job queue records. It does not yet include:

- background execution of queued worker jobs
- email, ad-platform, payment, GitHub, or deployment side effects
- voice
- self-modification
- autonomous publishing or spending

Those capabilities should be added as explicit tools with approval requirements rather than unrestricted agent access.
