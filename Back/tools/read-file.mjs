import { open, stat } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_READ_BYTES = 100_000;
const MAX_READ_BYTES = 1_000_000;

const fileError = (message, code, hint = null) => {
  const error = new Error(`read-file: ${message}`);
  error.code = code;
  error.retryable = false;
  if (hint) error.hint = hint;
  return error;
};

const tool = {
  name: "read-file",
  examples: [{ path: "/tmp/source.txt", start: 0, length: 4096 }],
  replay: "safe",
  timeoutMs: 60_000,
  description: "Reads a byte range from one regular local file. This Tool does not list directories. Reads are intentionally bounded so large files do not flood model context; use start/length to inspect additional ranges after discovery.",
  requiresApproval: false,
  input: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1, description: "Absolute or relative path to the regular file to read." },
      encoding: { type: "string", description: "Text encoding used to decode returned bytes.", default: "utf8" },
      start: { type: "integer", minimum: 0, description: "Zero-based byte offset. Defaults to 0.", default: 0 },
      length: { type: "integer", minimum: 1, maximum: MAX_READ_BYTES, description: `Bytes to read, maximum ${MAX_READ_BYTES}.` },
      maxBytes: {
        type: "number",
        description: "Legacy alias for length when length is omitted. Kept for compatibility with older Tasks.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute({ path, encoding = "utf8", start = 0, length = null, maxBytes = null } = {}) {
    if (typeof path !== "string" || path.length === 0) {
      throw fileError(
        '"path" is required and must be a non-empty string.',
        "tool_invalid_input",
        "Provide the path property exactly as declared by the read-file Tool schema.",
      );
    }
    if (!Number.isSafeInteger(start) || start < 0) throw fileError('"start" must be a non-negative integer.', "tool_invalid_input");

    const requested = length ?? maxBytes ?? DEFAULT_READ_BYTES;
    if (!Number.isSafeInteger(requested) || requested < 1 || requested > MAX_READ_BYTES) {
      throw fileError(`"length" must be an integer from 1 to ${MAX_READ_BYTES}.`, "tool_invalid_input");
    }

    const abs = resolve(path);
    let info;
    try {
      info = await stat(abs);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw fileError(
          `file does not exist: ${abs}`,
          "file_not_found",
          "Locate the file with a discovery or command Tool, then retry read-file with the discovered regular-file path.",
        );
      }
      if (["EACCES", "EPERM"].includes(error?.code)) {
        throw fileError(
          `permission denied: ${abs}`,
          "file_permission_denied",
          "Choose a readable file or use a command with the permissions available to Carlos Office.",
        );
      }
      throw error;
    }

    if (!info.isFile()) {
      throw fileError(
        `not a regular file: ${abs}`,
        "file_not_readable",
        "Do not use read-file to inspect directories. Locate a regular file first or use a discovery/command Tool.",
      );
    }

    const offset = Math.min(start, info.size);
    const bytes = Math.min(requested, info.size - offset);
    if (bytes <= 0) {
      return { path: abs, start: offset, end: offset, bytes: 0, totalBytes: info.size, eof: true, encoding, content: "" };
    }

    const handle = await open(abs, "r");
    try {
      const buffer = Buffer.allocUnsafe(bytes);
      const { bytesRead } = await handle.read(buffer, 0, bytes, offset);
      return {
        path: abs,
        start: offset,
        end: offset + bytesRead,
        bytes: bytesRead,
        totalBytes: info.size,
        eof: offset + bytesRead >= info.size,
        encoding,
        content: buffer.subarray(0, bytesRead).toString(encoding),
        instruction: offset + bytesRead < info.size
          ? `File continues. Read the next range with start=${offset + bytesRead}; keep reads narrow.`
          : "End of file reached.",
      };
    } finally {
      await handle.close();
    }
  },
};

export default tool;
