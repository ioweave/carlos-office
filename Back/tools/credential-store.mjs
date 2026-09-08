import { getCredential, listCredentials } from "../src/services/CredentialService.mjs";

const tool = {
  name: "credential-store",
  replay: "safe",
  examples: [{ operation: "list" }],
  description: "Lists credential profiles or checks whether one exists. Secret values are never returned to Agents or model providers. Carlos manages credentials from the Credentials page.",
  requiresApproval: false,
  provider: null,
  model: null,
  input: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["get", "list"],
        description: "Read credential metadata only. Secrets are never returned.",
      },
      service: {
        type: "string",
        description: "Credential service identifier. Required for get.",
      },
    },
    required: ["operation"],
    allOf: [{ if: { properties: { operation: { const: "get" } }, required: ["operation"] }, then: { required: ["service"] } }],
    additionalProperties: false,
  },
  output: {
    type: "object",
    description: "Credential metadata only; never contains a secret value.",
  },
  async execute(inputs = {}) {
    const operation = typeof inputs.operation === "string" ? inputs.operation : "";
    if (!["get", "list"].includes(operation)) {
      throw new Error(`credential-store: unknown operation "${operation}". Must be get or list.`);
    }

    if (operation === "list") return { services: listCredentials() };

    const service = typeof inputs.service === "string" ? inputs.service.trim() : "";
    if (!service) throw new Error('credential-store: "service" is required for get.');
    const credential = getCredential(service);
    return credential
      ? { service, found: true, credential }
      : { service, found: false };
  },
};

export default tool;
export { tool };
