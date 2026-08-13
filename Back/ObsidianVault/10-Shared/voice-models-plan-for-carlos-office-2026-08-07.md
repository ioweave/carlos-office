---
id: "8e3cbfca-d75a-4caf-8849-c17cb33c1e02"
title: "Voice models plan for Carlos Office (2026-08-07)"
scope: "shared"
agent: "Nora"
tags: ["plan","voice","tts","stt","kokoro","piper","xtts","chatterbox","whisper","carlos-office","2026-08-07","source-of-truth"]
source: "Live repository inspection 2026-08-07. Files: Back/src/controllers/OfficeController.mjs, Back/src/lib/agentRunner.mjs. External: huggingface.co/hexgrad/Kokoro-82M, localaimaster.com/blog/kokoro-tts-local-setup, findskill.ai/blog/best-open-source-tts-2026."
created: "2026-08-07T00:35:48.603Z"
updated: "2026-08-07T00:35:48.603Z"
---
# Voice models plan for Carlos Office (2026-08-07)

---
title: "Voice models plan for Carlos Office (2026-08-07)"
scope: "shared"
agent: "Nora"
tags: ["plan","voice","tts","stt","kokoro","piper","xtts","chatterbox","whisper","carlos-office","2026-08-07","source-of-truth"]
source: "Live repository inspection 2026-08-07. Files read: Back/src/controllers/OfficeController.mjs, Back/src/lib/agentRunner.mjs, Back/src/agents/agents.config.mjs (referenced), Back/src/lib/toolRegistry.mjs (referenced). Live search: project_search_files for 'voice|tts|speech|audio|whisper' returned 0 matches. Models live in Ollama: qwen3:8b, qwen3.6, gemma4 family (no voice). Agents live: nora, marco, luma, dex, iris, vera. External sources: huggingface.co/hexgrad/Kokoro-82M (model card), localaimaster.com/blog/kokoro-tts-local-setup, findskill.ai/blog/best-open-source-tts-2026, docs.gladecore.com/files/piper-voice-models."
---

# Voice models plan for Carlos Office (2026-08-07)

> Greenfield. No voice/TTS/STS code exists today (verified 2026-08-07).

## Recommendation

| Layer | Pick | License | Why |
|---|---|---|---|
| Default TTS | **hexgrad/Kokoro-82M** | Apache-2.0 | 82M params, ~327 MB weights, CPU-fast, 54 voices / 8 langs, 24 kHz, commercial OK. |
| Fallback TTS | **rhasspy/Piper** | MIT | CPU only, 30+ langs, runs on Raspberry Pi. |
| Cloning upgrade | **Coqui XTTS-v2** (or **Chatterbox-Turbo** MIT) | MPL-2.0 / MIT | 6-s reference clone. Chatterbox-Turbo beat ElevenLabs 65.3% vs 24.5% in vendor blind test. |
| STT | **ggerganov/whisper.cpp** | MIT | CPU, integrates cleanly with Node sidecar. |

Single best default: **Kokoro-82M**.

## Live repo facts (2026-08-07)

- `Back/src/controllers/OfficeController.mjs` — text-only endpoints (`/chat`, `/agents`, `/memory`, `/jobs`, `/tools/*`). No audio I/O.
- `Back/src/lib/agentRunner.mjs` — agent queue, tool calls, fallback, memory. Pure text.
- Search for `voice|tts|speech|audio|whisper` in the repo returned zero matches.
- Ollama install: `qwen3:8b`, `qwen3.6`, `gemma4` family. No TTS model in Ollama.
- Agents today with `system` prompts in `agents.config.mjs`: nora, marco, luma, dex, iris, vera. Adding per-agent `voice` field is a one-line schema extension.

## Target architecture

```
   mic ──► Whisper.cpp ─► OfficeController.chat (existing) ─► Ollama (LLM)
                                                                  │
                                                                  ▼ text
                                                            voice router (new)
                                                                  │
        ┌─────────────┬─────────────┬─────────────┬──────────────┴────────────┐
        ▼             ▼             ▼             ▼                            ▼
     Kokoro         Piper       XTTS-v2      Chatterbox                   openAI/etc
   (default)      (fallback)   (clone path)   (quality A/B)              (future cloud)
        │             │             │             │
        └─────────────┴──────┬──────┴─────────────┘
                             ▼
                  wav → Opus → base64 → Front <audio>
```

Two new components: `Back/src/modules/tts/` (engine modules) and `Back/src/lib/voiceRouter.mjs` (selection/fallback). Per-agent voice goes into `agents.config.mjs` as `voice: { engine, speaker }`.

## Per-agent voice defaults (proposed)

| Agent | Persona | Kokoro voice |
|---|---|---|
| Nora | Chief of Staff, calm | af_sarah |
| Marco | Commercial, direct | am_adam |
| Luma | Creative, warm | bf_emma |
| Dex | Dev, precise | am_michael |
| Iris | Research, measured | af_heart |
| Vera | QC, neutral | af_nicole |

## Phases

### Phase 0 — Approvals & infra
- Approve Kokoro default, cloning engine (XTTS vs Chatterbox), STT engine (whisper.cpp).
- Bootstrap: Python 3.10, `pip install kokoro soundfile`, `espeak-ng`, optional `piper` binary. Add to `claude_start.ps1`.

### Phase 1 — TTS end-to-end (text -> audio)
1. `Back/src/modules/tts/kokoro.mjs` (Python sidecar via `child_process.spawn`, JSON over stdio).
2. `POST /tts` in `Router.mjs` returning `{ audioBase64, mime: 'audio/wav', voice, durationMs, engine }`.
3. `ChatPage.jsx`: 🔊 button per assistant message; per-agent default voices loaded from `/agents`.
4. Settings page: Voice tab (global on/off, default engine, default voice, rate, per-agent override).
5. Acceptance (Vera): every assistant message has a working 🔊; global toggle hides all 🔊; no console errors; one-click playback; bounded timeout; AbortSignal cancels.

### Phase 2 — STT (mic -> text)
1. `Back/src/lib/stt.mjs` running `whisper.cpp` (`whisper-cli -m ggml-base.en.bin -f in.wav --output-json`).
2. Front Push-to-Talk widget via `MediaRecorder`.
3. `POST /stt` returns `{ text, language, segments[] }`.
4. `OfficeController.chat` accepts `body.audio` attachments, transcribes, sets `body.message = transcript`.
5. Acceptance: PTT on ChatPage; transcript appears (editable) before send; all existing memory/tool routes continue to work.

### Phase 3 — Streaming TTS
1. `POST /tts/stream` returns chunked PCM frames.
2. Front uses `AudioContext` + `RingBuffer`; playback starts before LLM finishes.
3. Sentence splitter at first iteration; cancellation via existing AbortSignal.
4. Acceptance: time-to-first-audio <= 1.5 s on a typical reply; cancelling the message cancels the audio.

### Phase 4 — Per-agent custom voices (clone path)
1. XTTS-v2 or Chatterbox-Turbo sidecar next to Kokoro.
2. `POST /agents/:id/voice` accepts a 6-s WAV reference; stores in `Back/ObsidianVault/90-System/Runtime/Voices/<agentId>.wav`.
3. Voice router prefers cloned voice when present.
4. Disclosure UI: "This uses a clone of your voice. Disable?"

### Phase 5 — Multi-agent voice room
- Concurrent TTS for every agent reply; OfficeMap avatars glow at the avatar colour while that agent speaks. Existing officeMap status stream already carries this.

## Risks

- Spanish accent for Marco: Kokoro ES voices thinner than EN. May need Spanish-accented English or earlier XTTS-v2 upgrade.
- Python sidecar is a new language on the back. Keep an HTTP fallback for swap.
- Voice cloning is a policy question, not just a model question.
- Without Phase 3, a 30-word reply will feel slow. Recommend shipping Phase 1 + Phase 3 together.

## Open question

One default voice for everyone (simpler) vs distinct persona voice per agent (richer, matches OfficeMap intent). Default plan is per-agent distinct voices.

## Jobs to create once Carlos approves

1. Dex job — "Voice TTS module (Kokoro)" — implements Phase 1.
2. Iris job — "TTS model landscape research note" — shared memory note with citations.
3. Vera QC of both.
