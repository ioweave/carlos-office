# External Integrations

Carlos Office integrates third-party software through ordinary Tools and Skills. External applications are not copied into the Carlos Office source tree and there is no separate plugin runtime.

## Skill convention

Carlos Office Skills are always flat Markdown files:

```text
Back/skills/<name>.md
```

Directory packages such as `skills/<name>/SKILL.md` are not part of the Carlos Office Skill contract.

## External software location

The default local checkout location is ignored by Git:

```text
Back/.carlos-office/integrations/
  Unlimited-OCR/
  OpenMontage/
```

You can place those repositories elsewhere and configure their paths with Workspace Variables.

## Workspace Variables

- `integration.unlimitedOcrPath` — path to the Unlimited-OCR checkout.
- `integration.openMontagePath` — path to the OpenMontage checkout.
- `integration.pythonCommand` — Python executable used by Python-backed integrations; defaults to `python`.
- `integration.agentReachCommand` — Agent Reach executable; defaults to `agent-reach`.
- `integration.minimaxH3Url` — MiniMax-H3 SGLang base URL; defaults to `http://localhost:30010`.

Equivalent environment variables are also supported:

- `UNLIMITED_OCR_HOME`
- `OPENMONTAGE_HOME`
- `PYTHON_COMMAND`
- `AGENT_REACH_COMMAND`
- `MINIMAX_H3_URL`

Workspace Variables take precedence over environment variables.

## Tools

### `unlimited-ocr`

Runs the upstream Unlimited-OCR `infer.py` entry point against a PDF, image, or image directory. OCR output stays in the Agent execution workspace and can be consumed by later Tasks or declared as Artifacts.

### `openmontage`

Uses OpenMontage's own Tool registry rather than duplicating its video-production architecture. The adapter can inspect its capability catalog, list registered tools, dry-run one tool, or execute one tool. Execution remains inside the external OpenMontage checkout while Carlos Office retains Workflow, authorization, and Artifact ownership.

### `agent-reach`

Exposes Agent Reach health/version/update checks, safe installation diagnostics, and transcription. Actual platform reads use the backend Agent Reach reports as healthy and are performed through existing Carlos Office Tools, keeping the adapter narrow rather than creating an unrestricted shell proxy.

### `minimax-h3`

Uses the MiniMax-H3 SGLang `/v1/videos` interface for generation, status inspection, and downloading completed video into the Agent workspace. Use the `minimax-h3-prompt-writing` Skill when constructing generation prompts.

## Installation

Carlos Office intentionally does not install or update these packages automatically. Install/deploy each package according to its upstream requirements, then point the corresponding Workspace Variable at it. This keeps CUDA/Python/FFmpeg/browser dependencies and third-party release cycles outside the Carlos Office Node runtime.
