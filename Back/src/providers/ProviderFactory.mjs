import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import config from "../config.mjs";
import { createOllamaProvider } from "./OllamaProvider.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const providerSettingsPath = resolve(here, "../../ObsidianVault/System/providers.json");

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const clean = value => typeof value === "string" ? value.trim() : "";

export const loadProviderSettingsFile = async () => {
  try {
    const parsed = JSON.parse(await readFile(providerSettingsPath, "utf8"));
    return isObject(parsed) ? parsed : {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
};

const builtInOllama = settings => {
  const stored = isObject(settings.ollama) ? settings.ollama : {};
  return {
    name: "ollama",
    type: "ollama",
    baseUrl: clean(stored.baseUrl) || clean(config.ollama?.baseUrl) || "http://localhost:11434/api",
    apiKeyEnv: clean(stored.apiKeyEnv) || "OLLAMA_API_KEY",
    enabled: stored.enabled !== false,
    builtIn: true,
  };
};

export const providerDefinitionsFromSettings = settings => {
  const definitions = new Map([["ollama", builtInOllama(settings)]]);

  for (const [name, stored] of Object.entries(settings ?? {})) {
    if (name === "ollama" || !isObject(stored) || !stored.type) continue;
    const providerName = clean(name);
    const type = clean(stored.type).toLowerCase();
    if (!providerName || type !== "ollama") continue;
    const baseUrl = clean(stored.baseUrl);
    if (!baseUrl) continue;
    definitions.set(providerName, {
      name: providerName,
      type,
      baseUrl,
      apiKeyEnv: clean(stored.apiKeyEnv),
      enabled: stored.enabled !== false,
      builtIn: false,
    });
  }

  return [...definitions.values()];
};

const apiKeyFor = definition => {
  if (definition.apiKeyEnv) {
    const value = process.env[definition.apiKeyEnv];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  if (definition.name === "ollama") return clean(config.ollama?.apiKey) || null;
  return null;
};

export const createConfiguredProviders = async () => {
  const settings = await loadProviderSettingsFile();
  const definitions = providerDefinitionsFromSettings(settings);
  const providers = new Map();

  for (const definition of definitions) {
    if (!definition.enabled) continue;
    if (definition.type === "ollama") {
      providers.set(definition.name, createOllamaProvider({
        name: definition.name,
        baseUrl: definition.baseUrl,
        apiKey: apiKeyFor(definition),
      }));
    }
  }

  return { settings, definitions, providers };
};
