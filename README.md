# Carlos Office

Local-first operating interface for Mer1dian's agent team: Nora, Marco, Luma, Dex, and Vera.

## Stack

- JavaScript only: `.mjs` backend and `.jsx` frontend
- Node.js ESM
- React + Vite
- Ollama for local and Ollama Cloud inference
- Obsidian-compatible Markdown for all persistent data
- no login and no database service

## Agent roles

- **Nora** — Chief of Staff and primary interface
- **Marco** — Commercial Strategy
- **Luma** — Creative Direction
- **Dex** — Development and Automation
- **Vera** — independent Quality Control and Acceptance

## Model routing

The default runtime is:

```text
Primary:  minimax-m3:cloud
Fallback: qwen3:8b
Policy:   fallback only for internet/cloud-connectivity failures
```

Authentication, quota, invalid-model, and configuration errors are not hidden by the fallback. They are returned to the UI so they can be corrected.

Prepare Ollama:

```powershell
ollama signin
ollama pull minimax-m3:cloud
ollama pull qwen3:8b
```

## Vera QC loop

Nora's delegated jobs require:

- a worker: Marco, Luma, or Dex
- concrete instructions
- a defined expected result
- objective acceptance criteria
- a bounded iteration limit from 1 to 8

The local workflow is:

```text
Nora creates job
    -> worker produces result
    -> Vera evaluates explicit acceptance criteria
        -> pass: job becomes completed
        -> revise: Vera feedback is sent into the next worker iteration
        -> limit reached: job becomes awaiting_approval
```

Jobs execute through a single local queue to avoid competing model runs. Pending jobs resume after a backend restart. Each output, Vera verdict, score, missing criterion, feedback item, model assignment, and iteration is stored in the same Markdown job note under `40-Jobs`.

The Jobs page refreshes active work automatically and can continue a failed or unaccepted job with up to two additional iterations, never exceeding eight.

## Obsidian-only storage

```text
CarlosOfficeVault/
├── 00-Inbox/
├── 10-Shared/
├── 20-Agents/
│   ├── Nora/
│   ├── Marco/
│   ├── Luma/
│   ├── Dex/
│   └── Vera/
├── 30-Conversations/
│   ├── Threads/
│   └── YYYY-MM-DD.md
├── 40-Jobs/
└── 90-System/
    └── Runtime/Agents/
```

Conversation history is available from the chat sidebar and can reopen any saved Markdown thread.

## Voice input and output

The chat interface supports:

- microphone dictation through the browser's Speech Recognition API
- manual playback of each assistant response
- optional automatic reading of new responses
- English and Spanish language selection

Voice is independent of the selected LLM. No microphone audio is sent to the Carlos Office backend.

## Start locally

Prerequisites:

- Node.js 20 or newer
- Ollama
- Obsidian, optional but recommended

Backend:

```powershell
cd Back
Copy-Item .env.example .env
npm install
npm run dev
```

Frontend:

```powershell
cd Front
Copy-Item .env.example .env
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

The vault defaults to `~/CarlosOfficeVault`. To use another location:

```env
OBSIDIAN_VAULT_PATH=C:\absolute\path\to\CarlosOfficeVault
MEMORY_TIME_ZONE=America/Guayaquil
```

## Backend environment

```env
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=minimax-m3:cloud
OLLAMA_FALLBACK_MODEL=qwen3:8b
```

## MCP server

```powershell
cd Back
npm run mcp
```

Shared tools include permanent memory, web research, current time, Ollama model inspection, agent listing, bounded QC job creation, job inspection, and job continuation.

## Validation

- [`NORA_VALIDATION.md`](./NORA_VALIDATION.md) — Nora's behavioral and functional acceptance checks
- [`VERA_QC_VALIDATION.md`](./VERA_QC_VALIDATION.md) — Vera's pass, revision, bounded-failure, restart, and continuation checks
