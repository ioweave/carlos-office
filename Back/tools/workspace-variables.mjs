import { getVariable, listVariables } from "../src/services/VariableService.mjs";

const tool = {
  name: "workspace-variables",
  description: "Reads non-secret Workspace Variables managed by Carlos in Store. Use them as shared task configuration. Never treat this store as a credential or secret vault.",
  requiresApproval: false,
  provider: null,
  model: null,
  input: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["get", "list"],
        description: "Read one variable or list all available variables.",
      },
      key: {
        type: "string",
        description: "Workspace Variable key. Required for get.",
      },
    },
    required: ["operation"],
    additionalProperties: false,
  },
  output: {
    type: "object",
    description: "Workspace Variable values and descriptions. These values are intentionally visible to Agents and model providers.",
  },
  async execute(inputs = {}) {
    const operation = typeof inputs.operation === "string" ? inputs.operation : "";
    if (!["get", "list"].includes(operation)) {
      throw new Error(`workspace-variables: unknown operation "${operation}". Must be get or list.`);
    }

    if (operation === "list") return { variables: listVariables() };

    const key = typeof inputs.key === "string" ? inputs.key.trim() : "";
    if (!key) throw new Error('workspace-variables: "key" is required for get.');
    const variable = getVariable(key);
    return variable
      ? { key, found: true, variable }
      : { key, found: false };
  },
};

export default tool;
export { tool };
