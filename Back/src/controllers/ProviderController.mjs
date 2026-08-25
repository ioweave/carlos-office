import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import config from "../config.mjs";
import { createOllamaProvider } from "../providers/OllamaProvider.mjs";

export const MODEL_CAPABILITIES = Object.freeze(["thinking", "vision", "audio", "embeddings"]);
const CATALOG_TTL_MS = 5 * 60 * 1000;
const here = dirname(fileURLToPath(import.meta.url));
const preferencesPath = resolve(here, "../../ObsidianVault/System/providers.json");
const providerInstances = new Map([["ollama", createOllamaProvider(config.ollama)]]);

let preferences = {};
let preferencesLoaded = false;
let catalog = [];
let catalogLoadedAt = 0;

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const clone = value => structuredClone(value);

const parseParameterCount = value => {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;

  const normalized = String(value).trim().replaceAll(",", "");
  const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)\s*([KMBT])?(?:\s*parameters?)?$/i);
  if (!match) return null;
  const multipliers = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
  const multiplier = match[2] ? multipliers[match[2].toUpperCase()] : 1;
  const result = Number(match[1]) * multiplier;
  return Number.isFinite(result) ? Math.round(result) : null;
};

const nullableCost = value => {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const normalizePricing = (raw, location) => {
  if (location === "local") return { inputUsd: 0, outputUsd: 0 };
  const pricing = isObject(raw?.costPerMillionTokens)
    ? raw.costPerMillionTokens
    : isObject(raw?.pricing)
      ? raw.pricing
      : {};
  return {
    inputUsd: nullableCost(pricing.inputUsd ?? pricing.input ?? pricing.input_per_million),
    outputUsd: nullableCost(pricing.outputUsd ?? pricing.output ?? pricing.output_per_million),
  };
};

const capabilitySupport = raw => {
  const values = Array.isArray(raw?.capabilities)
    ? raw.capabilities.map(value => String(value).toLowerCase())
    : null;
  if (!values) return Object.fromEntries(MODEL_CAPABILITIES.map(name => [name, null]));

  const aliases = {
    thinking: ["thinking", "reasoning"],
    vision: ["vision", "image", "images"],
    audio: ["audio", "speech"],
    embeddings: ["embedding", "embeddings"],
  };
  return Object.fromEntries(MODEL_CAPABILITIES.map(name => [
    name,
    aliases[name].some(alias => values.includes(alias)),
  ]));
};

const preferenceFor = (provider, model) => preferences?.[provider]?.models?.[model] ?? {};

const effectiveModel = (provider, raw) => {
  const name = String(raw.name ?? raw.model ?? "").trim();
  const location = raw.location === "cloud" || /(?:^|[-:])cloud$/i.test(name) ? "cloud" : "local";
  const support = capabilitySupport(raw);
  const preference = preferenceFor(provider, name);
  const capabilityPreferences = isObject(preference.capabilities) ? preference.capabilities : {};
  const discoveredPricing = normalizePricing(raw, location);
  const pricingPreference = isObject(preference.costPerMillionTokens) ? preference.costPerMillionTokens : {};

  const capabilities = Object.fromEntries(MODEL_CAPABILITIES.map(capability => {
    const supported = support[capability];
    const preferred = capabilityPreferences[capability];
    return [capability, {
      supported,
      enabled: supported === true ? (typeof preferred === "boolean" ? preferred : true) : false,
    }];
  }));

  return {
    provider,
    name,
    location,
    parameters: parseParameterCount(
      raw.parameters
      ?? raw.parameterCount
      ?? raw.details?.parameter_size
      ?? raw.details?.parameterSize,
    ),
    capabilities,
    costPerMillionTokens: {
      inputUsd: nullableCost(pricingPreference.inputUsd) ?? discoveredPricing.inputUsd,
      outputUsd: nullableCost(pricingPreference.outputUsd) ?? discoveredPricing.outputUsd,
    },
    available: raw.available !== false,
    enabled: typeof preference.enabled === "boolean" ? preference.enabled : true,
  };
};

const persistPreferences = async () => {
  await mkdir(dirname(preferencesPath), { recursive: true });
  await writeFile(preferencesPath, JSON.stringify(preferences, null, 2), "utf8");
};

export const loadProviderPreferences = async () => {
  try {
    const parsed = JSON.parse(await readFile(preferencesPath, "utf8"));
    preferences = isObject(parsed) ? parsed : {};
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    preferences = {};
  }
  preferencesLoaded = true;
  return clone(preferences);
};

const ensurePreferences = async () => {
  if (!preferencesLoaded) await loadProviderPreferences();
};

const refreshCatalog = async () => {
  await ensurePreferences();
  const providers = [];

  for (const [provider, instance] of providerInstances) {
    const discovered = typeof instance.listModelMetadata === "function"
      ? await instance.listModelMetadata()
      : (await instance.listModels()).map(name => ({ name }));
    providers.push({
      provider,
      models: discovered
        .map(model => effectiveModel(provider, model))
        .filter(model => model.name)
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true })),
    });
  }

  catalog = providers;
  catalogLoadedAt = Date.now();
  return clone(catalog);
};

export const listProviders = async ({ refresh = false } = {}) => {
  const stale = !catalog.length || Date.now() - catalogLoadedAt > CATALOG_TTL_MS;
  if (refresh || stale) return refreshCatalog();
  return clone(catalog);
};

export const isModelEnabled = (provider, model) => preferenceFor(provider, model).enabled !== false;

export const filterModelOptions = options => (
  Array.isArray(options)
    ? options
      .map(entry => ({
        provider: entry.provider,
        models: (entry.models ?? []).filter(model => isModelEnabled(entry.provider, model)),
      }))
      .filter(entry => entry.provider && entry.models.length)
    : []
);

const fallbackRoutingModel = (provider, name) => effectiveModel(provider, {
  name,
  location: /(?:^|[-:])cloud$/i.test(name) ? "cloud" : "local",
  capabilities: null,
  available: true,
});

export const getRoutingModels = async runtimeOptions => {
  await ensurePreferences();
  try {
    await listProviders();
  } catch (error) {
    console.warn(`[providers] Rich model discovery failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const byKey = new Map();
  for (const provider of catalog) {
    for (const model of provider.models) byKey.set(`${provider.provider}\u0000${model.name}`, model);
  }

  const result = [];
  for (const entry of runtimeOptions ?? []) {
    for (const name of entry.models ?? []) {
      const model = clone(byKey.get(`${entry.provider}\u0000${name}`) ?? fallbackRoutingModel(entry.provider, name));
      if (!model.enabled || !model.available) continue;
      result.push(model);
    }
  }
  return result;
};

export const updateModelPreferences = async (provider, modelName, changes) => {
  if (!provider || typeof provider !== "string") throw new Error("Provider is required");
  if (!modelName || typeof modelName !== "string") throw new Error("Model name is required");
  if (!isObject(changes)) throw new Error("Model preference changes must be an object");
  await ensurePreferences();

  let providers;
  try {
    providers = await listProviders();
  } catch {
    providers = catalog;
  }
  const current = providers
    .find(entry => entry.provider === provider)
    ?.models.find(model => model.name === modelName) ?? null;
  if (!current) throw new Error(`Unknown provider model: ${provider}/${modelName}`);

  preferences[provider] ??= { models: {} };
  preferences[provider].models ??= {};
  const previous = preferenceFor(provider, modelName);
  const next = { ...previous };

  if (changes.enabled != null) {
    if (typeof changes.enabled !== "boolean") throw new Error("Model enabled must be boolean");
    next.enabled = changes.enabled;
  }

  if (changes.capabilities != null) {
    if (!isObject(changes.capabilities)) throw new Error("Capabilities must be an object");
    next.capabilities = { ...(isObject(previous.capabilities) ? previous.capabilities : {}) };
    for (const [name, enabled] of Object.entries(changes.capabilities)) {
      if (!MODEL_CAPABILITIES.includes(name)) throw new Error(`Unknown model capability: ${name}`);
      if (typeof enabled !== "boolean") throw new Error(`Capability ${name} enabled must be boolean`);
      if (enabled && current.capabilities[name]?.supported !== true) {
        throw new Error(`Model ${modelName} does not report ${name} support`);
      }
      next.capabilities[name] = enabled;
    }
  }

  if (changes.costPerMillionTokens != null) {
    if (!isObject(changes.costPerMillionTokens)) throw new Error("Token cost must be an object");
    next.costPerMillionTokens = {
      ...(isObject(previous.costPerMillionTokens) ? previous.costPerMillionTokens : {}),
    };
    for (const key of ["inputUsd", "outputUsd"]) {
      if (!Object.prototype.hasOwnProperty.call(changes.costPerMillionTokens, key)) continue;
      const value = changes.costPerMillionTokens[key];
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
        throw new Error(`${key} must be a non-negative number or null`);
      }
      next.costPerMillionTokens[key] = value;
    }
  }

  preferences[provider].models[modelName] = next;
  await persistPreferences();
  catalogLoadedAt = 0;
  const refreshed = await listProviders({ refresh: true });
  return refreshed.find(entry => entry.provider === provider)?.models.find(model => model.name === modelName) ?? null;
};
