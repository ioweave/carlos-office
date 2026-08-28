import { getVariable } from "../src/services/VariableService.mjs";
import { runExternalCommand } from "../src/services/ExternalCommandService.mjs";
import { resolveWorkspacePath } from "../src/services/ExecutionWorkspaceService.mjs";

const tool = {
  name: "agent-reach",
  description: "Uses the installed Agent Reach package for health checks, version/update checks, safe installation diagnostics, and media transcription. Internet reading/search commands selected by Agent Reach are documented in the agent-reach Skill and run through existing Carlos Office Tools rather than an unrestricted wrapper.",
  requiresApproval: false,
  provider: null,
  model: null,
  input: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["doctor", "version", "check-update", "install-check", "transcribe"] },
      source: { type: "string", description: "URL or local media path for transcribe." },
      provider: { type: "string", enum: ["auto", "groq", "openai"], default: "auto" },
      output: { type: "string", description: "Optional transcript file path. Relative paths resolve in the Agent workspace." },
      channels: { type: "string", description: "Optional comma-separated channels for install-check." },
      timeoutMs: { type: "number", description: "Maximum runtime in milliseconds.", default: 300000 },
    },
    required: ["action"],
    additionalProperties: false,
  },
  output: { type: "object" },
  async execute(inputs = {}, context = {}) {
    const action = inputs.action;
    const command = getVariable("integration.agentReachCommand")?.value || process.env.AGENT_REACH_COMMAND || "agent-reach";
    const timeoutMs = inputs.timeoutMs ?? 300_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("agent-reach: timeoutMs must be positive");

    let args;
    if (action === "doctor") args = ["doctor", "--json"];
    else if (action === "version") args = ["version"];
    else if (action === "check-update") args = ["check-update"];
    else if (action === "install-check") {
      args = ["install", "--safe", "--env", "auto"];
      if (inputs.channels?.trim()) args.push("--channels", inputs.channels.trim());
    } else if (action === "transcribe") {
      if (typeof inputs.source !== "string" || !inputs.source.trim()) throw new Error("agent-reach: source is required for transcribe");
      args = ["transcribe", inputs.source.trim(), "--provider", inputs.provider || "auto"];
      if (inputs.output) args.push("--output", resolveWorkspacePath(context.workspaceDir, inputs.output));
    } else {
      throw new Error(`agent-reach: unknown action ${action}`);
    }

    const result = await runExternalCommand({ command, args, cwd: context.workspaceDir, timeoutMs, signal: context.signal });
    if (action === "doctor") {
      try { return { action, result: JSON.parse(result.stdout) }; } catch (error) {
        throw new Error(`agent-reach: doctor did not return valid JSON: ${error.message}`);
      }
    }
    return inputs.output && action === "transcribe"
      ? { action, output: resolveWorkspacePath(context.workspaceDir, inputs.output), log: result.stdout }
      : { action, result: result.stdout };
  },
};

export default tool;
export { tool };
