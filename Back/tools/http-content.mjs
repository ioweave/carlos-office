import { open, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = resolve(here, "../.runtime/http-content");
const MAX_READ_BYTES = 4_000_000;
const SEARCH_CHUNK_BYTES = 1_000_000;
const SEARCH_OVERLAP_BYTES = 8_192;

const validId = value => (
  typeof value === "string"
  && /^http-content-[a-f0-9-]+$/i.test(value)
  && basename(value) === value
);

const pathFor = id => {
  if (!validId(id)) throw new Error("http-content: invalid content id");
  return resolve(contentDir, id);
};

const readRange = async (id, start, length) => {
  const path = pathFor(id);
  const info = await stat(path);
  const offset = Math.min(Math.max(0, start), info.size);
  const bytes = Math.min(Math.max(1, length), MAX_READ_BYTES, info.size - offset);
  if (bytes <= 0) return { start: offset, end: offset, bytes: 0, text: "", eof: true, totalBytes: info.size };

  const handle = await open(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, offset);
    return {
      start: offset,
      end: offset + bytesRead,
      bytes: bytesRead,
      text: buffer.subarray(0, bytesRead).toString("utf8"),
      eof: offset + bytesRead >= info.size,
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
          snippet: current.subarray(before, after).toString("utf8"),
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
  description: "Reads or searches complete large HTTP response bodies previously captured by the http Tool. Use this instead of asking the model to ingest a multi-megabyte response at once.",
  requiresApproval: false,
  provider: null,
  model: null,
  input: {
    type: "object",
    properties: {
      id: { type: "string", description: "Content id returned by the http Tool." },
      action: { type: "string", enum: ["stat", "read", "search"], default: "stat" },
      start: { type: "number", description: "Byte offset for read. Defaults to 0.", default: 0 },
      length: { type: "number", description: `Bytes to read, maximum ${MAX_READ_BYTES}.`, default: 200000 },
      query: { type: "string", description: "Literal UTF-8 string to find for search." },
      maxMatches: { type: "number", description: "Maximum search matches, 1-50.", default: 10 },
    },
    required: ["id"],
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
      const start = Number.isSafeInteger(inputs.start) && inputs.start >= 0 ? inputs.start : 0;
      const length = Number.isSafeInteger(inputs.length) && inputs.length > 0 ? inputs.length : 200_000;
      return { id: inputs.id, ...(await readRange(inputs.id, start, length)) };
    }
    if (action === "search") {
      const maxMatches = Number.isSafeInteger(inputs.maxMatches)
        ? Math.min(50, Math.max(1, inputs.maxMatches))
        : 10;
      return { id: inputs.id, ...(await searchContent(inputs.id, inputs.query, maxMatches)) };
    }
    throw new Error(`http-content: unknown action ${action}`);
  },
};

export default tool;
export { tool };
