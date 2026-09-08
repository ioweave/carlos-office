import { open, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = resolve(here, "../.runtime/http-content");
const MAX_READ_BYTES = 512_000;
const DEFAULT_READ_BYTES = 80_000;
const SEARCH_CHUNK_BYTES = 1_000_000;
const SEARCH_OVERLAP_BYTES = 8_192;
const UTF8_BOUNDARY_BYTES = 3;

const validId = value => (
  typeof value === "string"
  && /^http-content-[a-f0-9-]+$/i.test(value)
  && basename(value) === value
);

const pathFor = id => {
  if (!validId(id)) throw new Error("http-content: invalid content id");
  return resolve(contentDir, id);
};

const utf8Start = (buffer, index) => {
  let value = Math.max(0, Math.min(index, buffer.length));
  while (value > 0 && value < buffer.length && (buffer[value] & 0xc0) === 0x80) value -= 1;
  return value;
};
const utf8End = (buffer, index) => {
  let value = Math.max(0, Math.min(index, buffer.length));
  while (value < buffer.length && (buffer[value] & 0xc0) === 0x80) value += 1;
  return value;
};
const utf8Text = (buffer, start = 0, end = buffer.length) => (
  buffer.subarray(utf8Start(buffer, start), utf8End(buffer, end)).toString("utf8")
);

const readRange = async (id, start, length) => {
  const path = pathFor(id);
  const info = await stat(path);
  const offset = Math.min(Math.max(0, start), info.size);
  const bytes = Math.min(length, info.size - offset);
  if (bytes <= 0) return { start: offset, end: offset, bytes: 0, text: "", eof: true, totalBytes: info.size };

  const expandedStart = Math.max(0, offset - UTF8_BOUNDARY_BYTES);
  const expandedEnd = Math.min(info.size, offset + bytes + UTF8_BOUNDARY_BYTES);
  const requested = expandedEnd - expandedStart;
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(requested);
    const { bytesRead } = await handle.read(buffer, 0, requested, expandedStart);
    const actual = buffer.subarray(0, bytesRead);
    const localStart = offset - expandedStart;
    const localEnd = Math.min(actual.length, localStart + bytes);
    const alignedStart = utf8Start(actual, localStart);
    const alignedEnd = utf8End(actual, localEnd);
    const absoluteStart = expandedStart + alignedStart;
    const absoluteEnd = expandedStart + alignedEnd;
    return {
      start: absoluteStart,
      end: absoluteEnd,
      bytes: absoluteEnd - absoluteStart,
      text: actual.subarray(alignedStart, alignedEnd).toString("utf8"),
      eof: absoluteEnd >= info.size,
      totalBytes: info.size,
    };
  } finally {
    await handle.close();
  }
};

const searchContent = async (id, query, maxMatches) => {
  if (typeof query !== "string" || !query) throw new Error("http-content: search query is required");
  const needle = Buffer.from(query, "utf8");
  if (!needle.length) throw new Error("http-content: search query is required");

  const path = pathFor(id);
  const info = await stat(path);
  const handle = await open(path, "r");
  const matches = [];
  let offset = 0;
  let carry = Buffer.alloc(0);

  try {
    while (offset < info.size && matches.length < maxMatches) {
      const requested = Math.min(SEARCH_CHUNK_BYTES, info.size - offset);
      const chunk = Buffer.allocUnsafe(requested);
      const { bytesRead } = await handle.read(chunk, 0, requested, offset);
      if (!bytesRead) break;
      const current = Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
      const baseOffset = offset - carry.length;
      let from = 0;

      while (matches.length < maxMatches) {
        const index = current.indexOf(needle, from);
        if (index < 0) break;
        const absolute = baseOffset + index;
        const before = Math.max(0, index - 160);
        const after = Math.min(current.length, index + needle.length + 240);
        matches.push({
          offset: absolute,
          snippet: utf8Text(current, before, after),
        });
        from = index + Math.max(1, needle.length);
      }

      carry = current.subarray(Math.max(0, current.length - SEARCH_OVERLAP_BYTES));
      offset += bytesRead;
    }
  } finally {
    await handle.close();
  }

  return { query, matches, totalBytes: info.size };
};

const tool = {
  name: "http-content",
  examples: [{ id: "http-content-example", action: "read", start: 0, length: 4096 }],
  replay: "safe",
  timeoutMs: 60_000,
  description: "Reads or searches complete readable HTTP response bodies previously captured by the http Tool. Use search first, then narrow reads around useful byte offsets. Reads are bounded and aligned to UTF-8 character boundaries so large documents do not flood or corrupt model context.",
  requiresApproval: false,
  provider: null,
  model: null,
  input: {
    type: "object",
    properties: {
      id: { type: "string", description: "Content id returned by the http Tool." },
      action: { type: "string", enum: ["stat", "read", "search"], default: "stat" },
      start: { type: "integer", minimum: 0, description: "Byte offset for read. Defaults to 0.", default: 0 },
      length: { type: "integer", minimum: 1, maximum: MAX_READ_BYTES, description: `Bytes to read, maximum ${MAX_READ_BYTES}.`, default: DEFAULT_READ_BYTES },
      query: { type: "string", description: "Literal UTF-8 string to find for search." },
      maxMatches: { type: "integer", minimum: 1, maximum: 50, description: "Maximum search matches, 1-50.", default: 10 },
    },
    required: ["id"],
    allOf: [{ if: { properties: { action: { const: "search" } }, required: ["action"] }, then: { required: ["query"] } }],
    additionalProperties: false,
  },
  output: { type: "object" },
  async execute(inputs = {}) {
    const action = inputs.action || "stat";
    const path = pathFor(inputs.id);
    if (action === "stat") {
      const info = await stat(path);
      return { id: inputs.id, totalBytes: info.size };
    }
    if (action === "read") {
      const start = inputs.start ?? 0;
      const length = inputs.length ?? DEFAULT_READ_BYTES;
      if (!Number.isSafeInteger(start) || start < 0) throw new Error("http-content: start must be a non-negative integer");
      if (!Number.isSafeInteger(length) || length < 1 || length > MAX_READ_BYTES) {
        throw new Error(`http-content: length must be an integer from 1 to ${MAX_READ_BYTES}`);
      }
      return { id: inputs.id, ...(await readRange(inputs.id, start, length)) };
    }
    if (action === "search") {
      const maxMatches = inputs.maxMatches ?? 10;
      if (!Number.isSafeInteger(maxMatches) || maxMatches < 1 || maxMatches > 50) {
        throw new Error("http-content: maxMatches must be an integer from 1 to 50");
      }
      return { id: inputs.id, ...(await searchContent(inputs.id, inputs.query, maxMatches)) };
    }
    throw new Error(`http-content: unknown action ${action}`);
  },
};

export default tool;
export { tool };
