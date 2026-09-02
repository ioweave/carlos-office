import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runExternalCommand } from "./ExternalCommandService.mjs";

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
  hint: "The PDF was preserved by the HTTP request but could not be converted to text. Install Poppler/pdftotext or use the Unlimited OCR Tool for scanned/image-only PDFs.",
});

export const parseHttpDocument = async ({ body, contentType, signal = null, timeoutMs = DEFAULT_PARSE_TIMEOUT_MS }) => {
  if (!pdfBody(body) && !pdfContentType(contentType)) return { detected: false };

  const workDir = resolve(parserRoot, randomUUID());
  const source = resolve(workDir, "source.pdf");
  const output = resolve(workDir, "parsed.txt");
  await mkdir(workDir, { recursive: true });

  try {
    await writeFile(source, body);
    await runExternalCommand({
      command: "pdftotext",
      args: ["-layout", "-enc", "UTF-8", source, output],
      timeoutMs,
      signal,
    });
    const text = await readFile(output, "utf8");
    if (!text.trim()) {
      return {
        detected: true,
        type: "pdf",
        parsed: false,
        parser: "pdftotext",
        requiresOcr: true,
        reason: "The PDF contains no extractable text and likely needs OCR.",
        hint: "Use the Unlimited OCR Tool when available for scanned/image-only PDFs.",
      };
    }
    return {
      detected: true,
      type: "pdf",
      parsed: true,
      parser: "pdftotext",
      requiresOcr: false,
      text,
      textBytes: Buffer.byteLength(text, "utf8"),
    };
  } catch (error) {
    return {
      detected: true,
      type: "pdf",
      parsed: false,
      parser: "pdftotext",
      requiresOcr: true,
      ...parserFailure(error),
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
};
