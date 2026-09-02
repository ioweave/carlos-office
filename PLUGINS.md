# Plugins

Carlos Office uses **Plugins** for installed executable software that lives outside the application source tree. A Plugin may be a Python project, CLI, compiled binary, local service wrapper, model runtime, or third-party checkout.

Plugins are implementation dependencies. They are not automatically visible to Agents.

## Taxonomy

- **Provider** — AI inference backend only. Providers expose models to Nora/Agents.
- **Plugin** — installed executable software used by Carlos Office or by one or more Tools.
- **Tool** — Agent-callable operation with a declared input/output contract and authorization boundary.
- **Skill** — reusable Markdown operating guidance supplied to an Agent.
- **Integration** — connection to another product or service. An Integration may use Credentials and Tools without requiring a local Plugin.

A Plugin may back several Tools, and a Plugin may also be used only by an internal service. A Tool does not require a Plugin when native Node code or an external API is sufficient.

## Location

The default Plugin root is deliberately outside the Carlos Office checkout:

```text
~/.carlos-office/plugins/
  agent-reach/
  document-extractor/
  openmontage/
  unlimited-ocr/
```

Override the root with the non-secret Workspace Variable `plugin.rootPath` or environment variable `CARLOS_OFFICE_PLUGINS_DIR`.

A specific Plugin path can be overridden with:

```text
plugin.<plugin-name>.path
```

For example:

```text
plugin.unlimited-ocr.path
plugin.openmontage.path
plugin.document-extractor.path
```

Carlos Office still recognizes the previous `Back/.carlos-office/integrations/Unlimited-OCR` and `OpenMontage` locations and their old Workspace Variables as compatibility fallbacks. New configuration should use Plugin names.

## Minimal Plugin contract

A Plugin directory may contain a small `plugin.json` manifest:

```json
{
  "name": "document-extractor",
  "version": "1.0.0",
  "type": "command",
  "command": ".venv/bin/python",
  "entrypoint": "extract.py"
}
```

Only the `command` Plugin type is currently supported. The manifest is intentionally small; Carlos Office does not load arbitrary Plugin code into the Node process.

`command` may be a PATH executable, absolute path, or path relative to the Plugin directory. `entrypoint` must remain inside the Plugin directory.

For compatibility with existing third-party checkouts, `plugin.json` is optional when the owning Tool already knows the upstream entrypoint.

## Command configuration

Per-Plugin command override:

```text
plugin.<plugin-name>.command
```

Shared Python command override:

```text
plugin.pythonCommand
```

Legacy `integration.pythonCommand` and existing environment variables remain compatibility fallbacks.

## Current Plugins

### `document-extractor`

Preferred PDF/document extraction implementation. The Plugin should expose:

```text
extract.py --input <source.pdf> --output <document.md>
```

The output file must be readable UTF-8 Markdown/text. This keeps Docling/docling-slim, OCR libraries, Python environments, and model dependencies outside Carlos Office. The current document parser automatically prefers this Plugin when installed and falls back to `pdftotext` when it is unavailable or fails.

A minimal deployment can install only the supported PDF pieces needed by the helper, for example `docling-slim[format-pdf]`, rather than cloning the Docling repository into Carlos Office.

### `unlimited-ocr`

Baidu Unlimited-OCR remains an external Plugin. The `unlimited-ocr` Tool is the Agent-facing adapter. Existing upstream checkouts without `plugin.json` continue to work through the conventional `infer.py` entrypoint.

### `openmontage`

OpenMontage remains an external Plugin. The `openmontage` Tool exposes only the narrow capability catalog/dry-run/execute boundary rather than importing OpenMontage internals into Carlos Office.

### `agent-reach`

Agent Reach is treated as a command Plugin. It may live under the Plugin root with a manifest or remain installed on `PATH`. The `agent-reach` Tool is its Agent-facing boundary.

## Installation policy

Carlos Office intentionally does not clone, install, or update third-party Plugins automatically. Install/deploy each Plugin according to its upstream requirements, then place it under the Plugin root or configure its path/command.

This keeps CUDA, Python, FFmpeg, browser automation, model weights, virtual environments, and third-party release cycles outside the Carlos Office Node runtime.

## Security boundary

Plugins run as separate processes. They do not inject JavaScript modules into the Platform and cannot register Agent capabilities directly.

Agents only receive Tools selected for the current Task. Tools remain responsible for:

- validating Agent input;
- resolving workspace paths;
- authorization policy;
- invoking the Plugin;
- normalizing Plugin output;
- recording Tool diagnostics.

This separation keeps the stable Carlos Office runtime small while allowing substantial external software to be reused by Carlos Office and other projects.
