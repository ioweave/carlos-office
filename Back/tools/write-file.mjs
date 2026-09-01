import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const tool = {
  name: "write-file",
  description: "Writes text content to a file on the local filesystem. Supports overwrite (default) or append modes and can create parent directories.",
  requiresApproval: false,
  input: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative path to the file to write." },
      content: { type: "string", description: "Text content to write to the file." },
      mode: { type: "string", enum: ["overwrite", "append"], description: "Write mode.", default: "overwrite" },
      encoding: { type: "string", description: "Text encoding to use when writing the file.", default: "utf8" },
      mkdir: { type: "boolean", description: "Create parent directories if they do not exist.", default: true },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  async execute({ path, content, mode = "overwrite", encoding = "utf8", mkdir: mkdirFlag = true } = {}) {
    if (typeof path !== "string" || path.length === 0) {
      const error = new Error('write-file: "path" is required and must be a non-empty string.');
      error.code = "tool_invalid_input";
      error.retryable = false;
      error.hint = "Provide the path property exactly as declared by the write-file Tool schema.";
      throw error;
    }
    if (typeof content !== "string") {
      const error = new Error('write-file: "content" is required and must be a string.');
      error.code = "tool_invalid_input";
      error.retryable = false;
      throw error;
    }
    if (!["overwrite", "append"].includes(mode)) {
      const error = new Error('write-file: "mode" must be overwrite or append.');
      error.code = "tool_invalid_input";
      error.retryable = false;
      throw error;
    }

    const abs = resolve(path);
    if (mkdirFlag) await mkdir(dirname(abs), { recursive: true });
    if (mode === "append") await appendFile(abs, content, { encoding });
    else await writeFile(abs, content, { encoding });
    return { path: abs, mode, bytes: Buffer.byteLength(content, encoding), encoding };
  },
};

export default tool;
