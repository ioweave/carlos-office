import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const fileError = (message, code, hint = null) => {
  const error = new Error(`read-file: ${message}`);
  error.code = code;
  error.retryable = false;
  if (hint) error.hint = hint;
  return error;
};

const tool = {
  name: "read-file",
  description: "Reads one regular file from the local filesystem and returns its text content with metadata. This Tool does not list directories; use an appropriate discovery or command Tool to locate files before reading them.",
  requiresApproval: false,
  input: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative path to the regular file to read." },
      encoding: { type: "string", description: "Text encoding to use when decoding the file.", default: "utf8" },
      maxBytes: { type: "number", description: "Maximum file size in bytes allowed to be read.", default: 5242880 },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute({ path, encoding = "utf8", maxBytes = 5242880 } = {}) {
    if (typeof path !== "string" || path.length === 0) {
      throw fileError(
        '"path" is required and must be a non-empty string.',
        "tool_invalid_input",
        "Provide the path property exactly as declared by the read-file Tool schema.",
      );
    }
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
      throw fileError('"maxBytes" must be a positive number.', "tool_invalid_input");
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
    if (info.size > maxBytes) {
      throw fileError(
        `file too large (${info.size} bytes > ${maxBytes} limit).`,
        "file_too_large",
        "Increase maxBytes deliberately or read a smaller file.",
      );
    }

    const content = await readFile(abs, { encoding });
    return { path: abs, bytes: info.size, encoding, content };
  },
};

export default tool;
