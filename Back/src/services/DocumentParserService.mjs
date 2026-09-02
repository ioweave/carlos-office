import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runExternalCommand } from "./ExternalCommandService.mjs";
import { resolvePlugin, resolvePluginEntrypoint, resolvePluginExecutable } from "./PluginService.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const parserRoot = resolve(here, "../../.runtime/document-parser");
const PDF_MAGIC = Buffer.from("%PDF-");
const PDF_MAGIC_SEARCH_BYTES = 1024;
const DEFAULT_PARSE_TIMEOUT_MS = 120_000;

const pdfBody = body => {
  if (!Buffer.isBuffer(body) || !body.length) return false;
  const index = body.subarray(0, Math.min(body.length, PDF_MAGIC_SEARCH_BYTES)).indexOf(PDF_MAGIC);
  return index >= 0;
};
const pdfContentType = contentType => String(contentType || "").toLowerCase().includes("application/pdf");
const parserFailure = error => ({
  code: typeof error?.code === "string" && error.code ? error.code : "document_parse_failed",
  reason: error instanceof Error ? error.message : String(error),
});
const resultFailure = result => ({
  code: result?.code || "document_parse_failed",
  reason: result?.reason || "Document extraction failed",
});

const parseWithPlugin = async ({ source, output, signal, timeoutMs }) => {
  const plugin = await resolvePlugin("document-extractor", { required: false });
  if (!plugin) return { attempted: false };

  try {
    const command = resolvePluginExecutable(plugin, {
      sharedVariableKey: "plugin.pythonCommand",
      legacyVariableKey: "integration.pythonCommand",
      envVariable: "PYTHON_COMMAND",
      fallback: "python",
    });
    const entrypoint = resolvePluginEntrypoint(plugin, "extract.py");
    await runExternalCommand({
      command,
      args: [entrypoint, "--input", source, "--output", output],
      cwd: plugin.home,
      timeoutMs,
      signal,
    });
    const text = await readFile(output, "utf8");
    if (!text.trim()) throw new Error("document-extractor Plugin returned an empty document");
    return {
      attempted: true,
      parsed: true,
      parser: "document-extractor",
      pluginVersion: plugin.manifest.version,
      text,
      textBytes: Buffer.byteLength(text, "utf8"),
    };
  } catch (error) {
    return { attempted: true, parsed: false, parser: "document-extractor", ...parserFailure(error) };
  }
};

const parseWithPdfText = async ({ source, output, signal, timeoutMs }) => {
  try {
    await runExternalCommand({
      command: "pdftotext",
      args: ["-layout", "-enc", "UTF-8", source, output],
      timeoutMs,
      signal,
    });
    const text = await readFile(output, "utf8");
    if (!text.trim()) {
      return {
        parsed: false,
        parser: "pdftotext",
        requiresOcr: true,
        reason: "The PDF contains no extractable text and needs document OCR.",
      };
    }
    return {
      parsed: true,
      parser: "pdftotext",
      requiresOcr: false,
      text,
      textBytes: Buffer.byteLength(text, "utf8"),
    };
  } catch (error) {
    return { parsed: false, parser: "pdftotext", requiresOcr: true, ...parserFailure(error) };
  }
};

export const parseHttpDocument = async ({ body, contentType, signal = null, timeoutMs = DEFAULT_PARSE_TIMEOUT_MS }) => {
  if (!pdfBody(body) && !pdfContentType(contentType)) return { detected: false };

  const workDir = resolve(parserRoot, randomUUID());
  const source = resolve(workDir, "source.pdf");
  const pluginOutput = resolve(workDir, "plugin-output.md");
  const textOutput = resolve(workDir, "parsed.txt");
  await mkdir(workDir, { recursive: true });

  try {
    await writeFile(source, body);
    const pluginResult = await parseWithPlugin({ source, output: pluginOutput, signal, timeoutMs });
    if (pluginResult.parsed) {
      return {
        detected: true,
        type: "pdf",
        requiresOcr: false,
        ...pluginResult,
      };
    }

    const textResult = await parseWithPdfText({ source, output: textOutput, signal, timeoutMs });
    if (textResult.parsed) {
      return {
        detected: true,
        type: "pdf",
        ...textResult,
        ...(pluginResult.attempted ? { pluginFallback: resultFailure(pluginResult) } : {}),
      };
    }

    return {
      detected: true,
      type: "pdf",
      ...textResult,
      ...(pluginResult.attempted ? { pluginFailure: resultFailure(pluginResult) } : {}),
      hint: "Install the document-extractor Plugin for structured PDF extraction or use the Unlimited-OCR Plugin for scanned/image-only PDFs.",
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
};
