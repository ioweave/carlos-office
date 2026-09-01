import { getProviderApiKey } from "../services/CredentialService.mjs";
import { loadProviderSettings } from "../services/ProviderRegistryService.mjs";
import { createOllamaProvider } from "./OllamaProvider.mjs";

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const clean = value => typeof value === "string" ? value.trim() : "";

export const providerDefinitionsFromSettings = settings => Object.entries(settings ?? {})
  .filter(([, stored]) => isObject(stored))
  .map(([name, stored]) => ({
    name: clean(name),
    type: clean(stored.type || "ollama").toLowerCase(),
    baseUrl: clean(stored.baseUrl),
    credentialService: clean(stored.credentialService),
    enabled: stored.enabled !== false,
    builtIn: stored.builtIn === true || name === "ollama",
    models: isObject(stored.models) ? stored.models : {},
  }))
  .filter(definition => definition.name && definition.baseUrl && definition.type === "ollama");

export const createProviderFromDefinition = definition => {
  if (!definition || typeof definition !== "object") throw new Error("Provider definition is required");
  if (definition.type !== "ollama") throw new Error(`Unsupported provider adapter: ${definition.type}`);
  const apiKey = definition.credentialService
    ? getProviderApiKey({ service: definition.credentialService, url: definition.baseUrl })
    : null;
  return createOllamaProvider({
    name: definition.name,
    baseUrl: definition.baseUrl,
    apiKey,
    modelSettings: isObject(definition.models) ? definition.models : {},
  });
};

export const createConfiguredProviders = async () => {
  const settings = loadProviderSettings();
  const definitions = providerDefinitionsFromSettings(settings);
  const providers = new Map();

  for (const definition of definitions) {
    if (!definition.enabled) continue;
    providers.set(definition.name, createProviderFromDefinition(definition));
  }

  return { settings, definitions, providers };
};
