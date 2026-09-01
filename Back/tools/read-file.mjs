import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const tool = {
  name: "read-file",
  description: "Reads the contents of a file from the local filesystem and returns the text content with metadata.",
  requiresApproval: false,
  input: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative path to the file to read." },
      encoding: { type: "string", description: "Text encoding to use when decoding the file.", default: "utf8" },
      maxBytes: { type: "number", description: "Maximum file size in bytes allowed to be read.", default: 5242880 },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute({ path, encoding = "utf8", maxBytes = 5242880 } = {}) {
    if (typeof path !== "string" || path.length === 0) {
      const error = new Error('read-file: "path" is required and must be a non-empty string.');
      error.code = "tool_invalid_input";
      error.retryable = false;
      error.hint = "Provide the path property exactly as declared by the read-file Tool schema.";
      throw error;
    }
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
      const error = new Error('read-file: "maxBytes" must be a positive number.');
      error.code = "tool_invalid_input";
      error.retryable = false;
      throw error;
    }
    const abs = resolve(path);
    const info = await stat(abs);
    if (!info.isFile()) {
      const error = new Error(`read-file: not a regular file: ${abs}`);
      error.code = "file_not_readable";
      error.retryable = false;
      error.hint = "Choose an existing regular file path before retrying.";
      throw error;
    }
    if (info.size > maxBytes) {
      const error = new Error(`read-file: file too large (${info.size} bytes > ${maxBytes} limit).`);
      error.code = "file_too_large";
      error.retryable = false;
      error.hint = "Increase maxBytes deliberately or read a smaller file.";
      throw error;
    }
    const content = await readFile(abs, { encoding });
    return { path: abs, bytes: info.size, encoding, content };
  },
};

export default tool;
