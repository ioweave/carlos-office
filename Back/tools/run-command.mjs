import { runExternalCommand } from "../src/services/ExternalCommandService.mjs";
import { resolveWorkspacePath } from "../src/services/ExecutionWorkspaceService.mjs";

const commandError = (message, code, hint = null) => {
  const error = new Error(`run-command: ${message}`);
  error.code = code;
  error.retryable = false;
  if (hint) error.hint = hint;
  return error;
};

const tool = {
  name: "run-command",
  description: "Runs one local executable directly on the Carlos Office host without shell interpretation. Use it for Ubuntu system inspection and command-line utilities such as ls, find, ps, ss, systemctl, git, or python when filesystem and HTTP Tools are insufficient. Arguments must be provided separately. Relative working directories resolve inside the Agent workspace; absolute working directories are allowed when the Task explicitly requires inspecting an existing host path.",
  requiresApproval: true,
  provider: null,
  model: null,
  input: {
    type: "object",
    properties: {
      command: { type: "string", description: "Executable name available on PATH or an absolute executable path." },
      args: { type: "array", items: { type: "string" }, description: "Arguments passed directly to the executable. Shell metacharacters are not interpreted.", default: [] },
      cwd: { type: "string", description: "Optional working directory. Relative paths resolve inside the Agent workspace." },
      stdin: { type: ["string", "null"], description: "Optional UTF-8 text written to the command standard input.", default: null },
      timeoutMs: { type: "number", description: "Maximum runtime in milliseconds.", default: 300000 },
    },
    required: ["command"],
    additionalProperties: false,
  },
  output: {
    type: "object",
    properties: {
      command: { type: "string" },
      args: { type: "array", items: { type: "string" } },
      cwd: { type: ["string", "null"] },
      stdout: { type: "string" },
      stderr: { type: "string" },
    },
  },
  async execute(inputs = {}, context = {}) {
    const command = typeof inputs.command === "string" ? inputs.command.trim() : "";
    if (!command) throw commandError('"command" is required and must be a non-empty string.', "tool_invalid_input");

    const args = inputs.args ?? [];
    if (!Array.isArray(args) || args.some(argument => typeof argument !== "string")) {
      throw commandError('"args" must be an array of strings.', "tool_invalid_input");
    }
    const timeoutMs = inputs.timeoutMs ?? 300_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw commandError('"timeoutMs" must be a positive number.', "tool_invalid_input");
    }

    const cwd = inputs.cwd
      ? resolveWorkspacePath(context.workspaceDir, inputs.cwd)
      : (context.workspaceDir ?? null);

    try {
      const result = await runExternalCommand({
        command,
        args,
        cwd,
        input: inputs.stdin ?? null,
        timeoutMs,
        signal: context.signal,
      });
      return { command, args: [...args], cwd, stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw commandError(
          `executable not found: ${command}`,
          "command_not_found",
          "Choose an executable installed on this host or provide its absolute path.",
        );
      }
      if (error?.code === "external_command_failed" && !error.hint) {
        error.hint = "Inspect the command error and change the executable, arguments, working directory, or strategy before retrying.";
      }
      throw error;
    }
  },
};

export default tool;
export { tool };
