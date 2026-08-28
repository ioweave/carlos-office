import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getVariable } from "../src/services/VariableService.mjs";
import { runExternalCommand } from "../src/services/ExternalCommandService.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const defaultHome = resolve(here, "../.carlos-office/integrations/OpenMontage");
const marker = "__CARLOS_OFFICE_JSON__";
const bridge = [
  "import dataclasses, json, sys",
  "from tools.tool_registry import registry",
  "registry.discover()",
  "action = sys.argv[1]",
  "if action == 'catalog':",
  "    value = registry.provider_menu_summary()",
  "elif action == 'list-tools':",
  "    value = registry.list_all()",
  "else:",
  "    name = sys.argv[2]",
  "    tool = registry.get(name)",
  "    if tool is None: raise SystemExit(f'Unknown OpenMontage tool: {name}')",
  "    payload = json.loads(sys.stdin.read() or '{}')",
  "    value = tool.dry_run(payload) if action == 'dry-run' else tool.execute(payload)",
  "    if dataclasses.is_dataclass(value): value = dataclasses.asdict(value)",
  `print('${marker}' + json.dumps(value, default=str))`,
].join("\n");

const tool = {
  name: "openmontage",
  description: "Bridges Carlos Office to an external OpenMontage checkout without copying its orchestration into Carlos Office. It can inspect OpenMontage's capability catalog or invoke one registered OpenMontage Tool. Direct Carlos-requested use is authorized by the Workflow authority model; autonomous use remains approval-gated because OpenMontage tools may spend money or publish content.",
  requiresApproval: true,
  provider: null,
  model: null,
  input: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["catalog", "list-tools", "dry-run", "execute"], default: "catalog" },
      tool: { type: "string", description: "OpenMontage Tool name for dry-run or execute." },
      inputs: { type: "object", description: "Input object passed to the OpenMontage Tool.", default: {} },
      timeoutMs: { type: "number", description: "Maximum runtime in milliseconds.", default: 1800000 },
    },
    additionalProperties: false,
  },
  output: { type: "object" },
  async execute(inputs = {}, context = {}) {
    const action = inputs.action || "catalog";
    if (!["catalog", "list-tools", "dry-run", "execute"].includes(action)) throw new Error(`openmontage: unknown action ${action}`);
    if (["dry-run", "execute"].includes(action) && (typeof inputs.tool !== "string" || !inputs.tool.trim())) {
      throw new Error(`openmontage: tool is required for ${action}`);
    }
    if (inputs.inputs != null && (!inputs.inputs || typeof inputs.inputs !== "object" || Array.isArray(inputs.inputs))) {
      throw new Error("openmontage: inputs must be an object");
    }
    const timeoutMs = inputs.timeoutMs ?? 1_800_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("openmontage: timeoutMs must be positive");

    const home = getVariable("integration.openMontagePath")?.value || process.env.OPENMONTAGE_HOME || defaultHome;
    const python = getVariable("integration.pythonCommand")?.value || process.env.PYTHON_COMMAND || "python";
    const args = ["-c", bridge, action];
    if (inputs.tool) args.push(inputs.tool.trim());
    const result = await runExternalCommand({
      command: python,
      args,
      cwd: context.workspaceDir || home,
      input: JSON.stringify(inputs.inputs ?? {}),
      env: { PYTHONPATH: [home, process.env.PYTHONPATH].filter(Boolean).join(delimiter) },
      timeoutMs,
      signal: context.signal,
    });
    const line = result.stdout.split(/\r?\n/).findLast(value => value.startsWith(marker));
    if (!line) throw new Error("openmontage: bridge did not return a structured result");
    return { action, result: JSON.parse(line.slice(marker.length)) };
  },
};

export default tool;
export { tool };
