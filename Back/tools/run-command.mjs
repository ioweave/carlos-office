import { runExternalCommand } from "../src/services/ExternalCommandService.mjs";
import { resolveWorkspacePath } from "../src/services/ExecutionWorkspaceService.mjs";

const commandError = (message, code, hint = null) => {
  const error = new Error(`run-command: ${message}`);
  error.code = code;
  error.retryable = false;
  if (hint) error.hint = hint;
  return error;
};

const shouldUseShell = (command, args) => {
  if (/\s|[|&;<>()$`]/.test(command)) return true;
  if (args.length !== 1) return false;

  const argument = args[0].trim();
  const executable = command.split("/").at(-1);
  return argument.startsWith(`${command} `)
    || argument.startsWith(`${executable} `)
    || /\s|[|&;<>()$`]/.test(argument);
};

const shellCommand = (command, args) => {
  if (/\s|[|&;<>()$`]/.test(command)) return command;
  const argument = args[0]?.trim() ?? "";
  const executable = command.split("/").at(-1);
  if (argument.startsWith(`${command} `) || argument.startsWith(`${executable} `)) return argument;
  return `${command}${argument ? ` ${argument}` : ""}`;
};

const tool = {
  name: "run-command",
  description: "Runs a Linux command on the Carlos Office host. Prefer command as the executable plus tokenized args. For resilience, Carlos Office also accepts common shell-style model output such as one full command line in command or one full command line packed into a single args item; those forms are normalized through /bin/bash -lc so quoting, redirection, pipes, and environment variables work as expected. Relative working directories resolve inside the Agent workspace; absolute working directories are allowed when the Task explicitly requires inspecting an existing host path.",
  requiresApproval: true,
  provider: null,
  model: null,
  input: {
    type: "object",
    properties: {
      command: { type: "string", description: "Executable name or a complete Linux shell command line." },
      args: {
        type: "array",
        items: { type: "string" },
        description: "Preferred: one array element per executable argument. A single full shell-style command line is also accepted and normalized automatically.",
        default: [],
      },
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
      mode: { type: "string", enum: ["direct", "shell"] },
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
    const useShell = shouldUseShell(command, args);
    const executedCommand = useShell ? "/bin/bash" : command;
    const executedArgs = useShell ? ["-lc", shellCommand(command, args)] : args;

    try {
      const result = await runExternalCommand({
        command: executedCommand,
        args: executedArgs,
        cwd,
        input: inputs.stdin ?? null,
        timeoutMs,
        signal: context.signal,
      });
      return {
        command,
        args: [...args],
        mode: useShell ? "shell" : "direct",
        cwd,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw commandError(
          `executable not found: ${useShell ? "/bin/bash" : command}`,
          "command_not_found",
          "Choose an executable installed on this host or provide its absolute path.",
        );
      }
      if (error?.code === "external_command_failed" && !error.hint) {
        error.hint = "Inspect stderr and change the command, arguments, working directory, or strategy before retrying.";
      }
      throw error;
    }
  },
};

export default tool;
export { tool };
