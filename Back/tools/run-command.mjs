import { runExternalCommand } from "../src/services/ExternalCommandService.mjs";
import { resolveWorkspacePath } from "../src/services/ExecutionWorkspaceService.mjs";

const commandError = (message, code, hint = null) => {
  const error = new Error(`run-command: ${message}`);
  error.code = code;
  error.retryable = false;
  if (hint) error.hint = hint;
  return error;
};

const shouldUseShell = (mode, command, args) => {
  if (mode === "shell") return true;
  if (mode === "direct") return false;
  if (/\s|[|&;<>()$`]/.test(command)) return true;
  if (args.length !== 1) return false;

  const argument = args[0].trim();
  const executable = command.split("/").at(-1);
  return argument.startsWith(`${command} `)
    || argument.startsWith(`${executable} `)
    || /[|&;<>()$`]/.test(argument);
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
  description: "Runs a Linux command on the Carlos Office host. Prefer mode=direct with command plus tokenized args. Use mode=shell only when pipes, redirects, shell expansion, or compound shell syntax are required. mode=auto remains the compatibility default for tolerant LLM output. Non-zero exit codes are returned as structured results by default so discovery commands such as grep, test, and diff can be reasoned about without turning ordinary negative results into Tool exceptions.",
  requiresApproval: true,
  provider: null,
  model: null,
  input: {
    type: "object",
    properties: {
      command: { type: "string", description: "Executable name or, in shell mode, a complete Linux shell command line." },
      args: {
        type: "array",
        items: { type: "string" },
        description: "One array element per executable argument. In auto mode one shell-style command line is also tolerated.",
        default: [],
      },
      mode: {
        type: "string",
        enum: ["direct", "shell", "auto"],
        description: "Execution mode. direct preserves argv exactly; shell uses /bin/bash -lc; auto tolerates common LLM shell-style output.",
        default: "auto",
      },
      cwd: { type: "string", description: "Optional working directory. Relative paths resolve inside the Agent workspace." },
      stdin: { type: ["string", "null"], description: "Optional UTF-8 text written to standard input.", default: null },
      timeoutMs: { type: "number", description: "Maximum runtime in milliseconds.", default: 300000 },
      failOnNonZero: {
        type: "boolean",
        description: "When true, non-zero exit codes become Tool failures. Defaults to false so normal discovery negatives remain inspectable.",
        default: false,
      },
    },
    required: ["command"],
    additionalProperties: false,
  },
  output: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      exitCode: { type: "number" },
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
    const mode = inputs.mode ?? "auto";
    if (!["direct", "shell", "auto"].includes(mode)) {
      throw commandError('"mode" must be direct, shell, or auto.', "tool_invalid_input");
    }
    const timeoutMs = inputs.timeoutMs ?? 300_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw commandError('"timeoutMs" must be a positive number.', "tool_invalid_input");
    }

    const cwd = inputs.cwd
      ? resolveWorkspacePath(context.workspaceDir, inputs.cwd)
      : (context.workspaceDir ?? null);
    const useShell = shouldUseShell(mode, command, args);
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
        rejectOnNonZero: inputs.failOnNonZero === true,
      });
      return {
        ok: result.exitCode === 0,
        exitCode: result.exitCode,
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
