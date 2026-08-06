# Carlos Office

Local-first operating interface for Mer1dian's agent team: Nora, Marco, Luma, and Dex.

## Stack

- JavaScript only: `.mjs` backend and `.jsx` frontend
- Node.js ESM
- React + Vite
- Ollama for local and Ollama Cloud inference
- Obsidian-compatible Markdown for all persistent data
- no login and no database service

## Model routing

The default runtime is:

```text
Primary:  minimax-m3:cloud
Fallback: qwen3:8b
Policy:   fallback only for internet/cloud-connectivity failures
```

Authentication, quota, invalid-model, and configuration errors are not hidden by the fallback. They are returned to the UI so they can be corrected.

Existing installations created with `qwen3:8b` as the original default are migrated automatically when the agent configuration is next loaded. Manual model changes made after migration remain editable from the Agents screen.

Prepare Ollama:

```powershell
ollama signin
ollama pull minimax-m3:cloud
ollama pull qwen3:8b
```

Ollama Cloud models are accessed through the local Ollama API at `http://127.0.0.1:11434`, so Carlos Office keeps one provider configuration for both the cloud primary and local fallback.

## Obsidian-only storage

```text
CarlosOfficeVault/
├── 00-Inbox/                    Worker memory proposals for Nora
├── 10-Shared/                   Curated company memory
├── 20-Agents/                   Agent-specific durable memory
├── 30-Conversations/
│   ├── Threads/                 Complete chat threads
│   └── YYYY-MM-DD.md            Daily conversation journals
├── 40-Jobs/                     Delegated job records
└── 90-System/
    └── Runtime/Agents/          Provider and model settings
```

Conversation history is available from the chat sidebar and can reopen any saved Markdown thread.

## Voice input and output

The chat interface supports:

- microphone dictation through the browser's Speech Recognition API
- manual playback of each assistant response
- optional automatic reading of new responses
- English and Spanish language selection

Voice is independent of the selected LLM. Text generation still comes from MiniMax M3 or the local Qwen fallback.

Speech synthesis normally uses installed browser or operating-system voices. Browser speech recognition support varies and may use the browser vendor's online recognition service. Chrome or Edge provides the most practical Windows experience. No microphone audio is sent to the Carlos Office backend.

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

The application also tolerates an older local `.env` containing `OLLAMA_MODEL=qwen3:8b`; that original default is upgraded to MiniMax M3 during migration.

## MCP server

```powershell
cd Back
npm run mcp
```

Shared tools include permanent memory, web research, current time, Ollama model inspection, agent listing, and durable job creation.

## Validation

Use [`NORA_VALIDATION.md`](./NORA_VALIDATION.md) for the behavioral and functional acceptance checks.
