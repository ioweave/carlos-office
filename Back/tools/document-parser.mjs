import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { parseHttpDocument } from "../src/services/DocumentParserService.mjs";
import { resolveWorkspacePath } from "../src/services/ExecutionWorkspaceService.mjs";

const INLINE_TEXT_CHARS = 80_000;

const tool = {
  name: "document-parser",
  description: "Converts a PDF in the Agent workspace into readable UTF-8 text through the document extraction boundary. When the document-extractor Plugin is installed it is preferred; Carlos Office falls back to native pdftotext extraction and reports when OCR is still required. Large extracted text is written to the workspace for narrow read-file access.",
  requiresApproval: false,
  provider: null,
  model: null,
  input: {
    type: "object",
    properties: {
      source: { type: "string", description: "PDF path. Relative paths resolve inside the Agent workspace." },
      output: { type: "string", description: "Optional extracted text path. Defaults to parsed-documents/<id>.txt." },
      timeoutMs: { type: "number", description: "Parser timeout in milliseconds. Defaults to 120000.", default: 120000 },
    },
    required: ["source"],
    additionalProperties: false,
  },
  output: { type: "object" },
  async execute(inputs = {}, context = {}) {
    if (typeof inputs.source !== "string" || !inputs.source.trim()) throw new Error("document-parser: source is required");
    const timeoutMs = inputs.timeoutMs ?? 120_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("document-parser: timeoutMs must be positive");

    const source = resolveWorkspacePath(context.workspaceDir, inputs.source.trim());
    const body = await readFile(source);
    const result = await parseHttpDocument({
      body,
      contentType: "application/pdf",
      signal: context.signal ?? null,
      timeoutMs,
    });
    const { text, ...details } = result;
    if (!result.parsed) return { ok: true, source: inputs.source, ...details };

    if (text.length <= INLINE_TEXT_CHARS) {
      return { ok: true, source: inputs.source, ...details, text };
    }

    const output = inputs.output?.trim() || `parsed-documents/${randomUUID()}.txt`;
    const path = resolveWorkspacePath(context.workspaceDir, output);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, "utf8");
    return {
      ok: true,
      source: inputs.source,
      ...details,
      text: null,
      output,
      instruction: "Extracted text is stored in the Agent workspace. Use read-file with offset/length to inspect only the relevant ranges.",
    };
  },
};

export default tool;
export { tool };
