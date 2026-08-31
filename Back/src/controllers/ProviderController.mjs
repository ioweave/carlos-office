import { getNora } from "../registry/Nora.mjs";
import { notifyOfficeStateChanged } from "../services/OfficeStateBus.mjs";
import {
  createConfiguredProviders,
  createProviderFromDefinition,
  providerDefinitionsFromSettings,
} from "../providers/ProviderFactory.mjs";
import {
  loadProviderSettings,
  replaceProviderSettings,
} from "../services/ProviderRegistryService.mjs";

export const MODEL_CAPABILITIES = Object.freeze(["thinking", "vision", "audio", "embeddings"]);
const CATALOG_TTL_MS = 5 * 60 * 1000;
const MAX_JSON_BODY_BYTES = 1_000_000;
const PROVIDER_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

let preferences = {};
let preferencesLoaded = false;
let catalog = [];
let catalogLoadedAt = 0;

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const clone = value => structuredClone(value);
const clean = value => typeof value === "string" ? value.trim() : "";
const partsFrom = pathname => pathname.split("/").filter(Boolean).map(decodeURIComponent);

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
    : isObject(raw?.pricing) ? raw.pricing : {};
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
  return Object.fromEntries(MODEL_CAPABILITIES.map(name => [name, aliases[name].some(alias => values.includes(alias))]));
};

const providerSettings = provider => (isObject(preferences?.[provider]) ? preferences[provider] : {});
const preferenceFor = (provider, model) => providerSettings(provider).models?.[model] ?? {};

const effectiveModel = (provider, raw) => {
  const name = clean(raw.name ?? raw.model);
  const preference = preferenceFor(provider, name);
  const location = raw.location === "cloud" || /(?:^|[-:])cloud$/i.test(name) ? "cloud" : "local";
  const support = capabilitySupport(raw);
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
    parameters: parseParameterCount(raw.parameters ?? raw.parameterCount ?? raw.details?.parameter_size ?? raw.details?.parameterSize),
    capabilities,
    costPerMillionTokens: {
      inputUsd: nullableCost(pricingPreference.inputUsd) ?? discoveredPricing.inputUsd,
      outputUsd: nullableCost(pricingPreference.outputUsd) ?? discoveredPricing.outputUsd,
    },
    available: raw.available !== false,
    enabled: typeof preference.enabled === "boolean" ? preference.enabled : true,
    registered: Boolean(preference.manual),
  };
};

const manualRaw = (name, preference, providerAvailable) => ({
  name,
  location: preference.location === "cloud" ? "cloud" : "local",
  parameters: preference.parameters ?? null,
  capabilities: Array.isArray(preference.supportedCapabilities) ? preference.supportedCapabilities : null,
  pricing: preference.costPerMillionTokens ?? null,
  available: providerAvailable,
});

const persistPreferences = () => {
  preferences = replaceProviderSettings(preferences);
  return clone(preferences);
};

export const loadProviderPreferences = async () => {
  preferences = loadProviderSettings();
  preferencesLoaded = true;
  return clone(preferences);
};

const ensurePreferences = async () => {
  if (!preferencesLoaded) await loadProviderPreferences();
};

const refreshCatalog = async () => {
  await ensurePreferences();
  const { definitions, providers } = await createConfiguredProviders();
  const result = [];

  for (const definition of definitions) {
    const instance = providers.get(definition.name) ?? null;
    let providerAvailable = Boolean(instance && definition.enabled);
    let providerError = null;
    let discovered = [];

    if (instance && definition.enabled) {
      try {
        discovered = typeof instance.listModelMetadata === "function"
          ? await instance.listModelMetadata()
          : (await instance.listModels()).map(name => ({ name }));
      } catch (error) {
        providerAvailable = false;
        providerError = error instanceof Error ? error.message : String(error);
      }
    }

    const rawByName = new Map(discovered
      .filter(model => clean(model?.name ?? model?.model))
      .map(model => [clean(model.name ?? model.model), { ...model, available: providerAvailable }]));

    const configuredModels = providerSettings(definition.name).models ?? {};
    for (const [modelName, modelPreference] of Object.entries(configuredModels)) {
      if (!rawByName.has(modelName)) rawByName.set(modelName, manualRaw(modelName, modelPreference, providerAvailable));
    }

    result.push({
      provider: definition.name,
      type: definition.type,
      baseUrl: definition.baseUrl,
      credentialService: definition.credentialService || null,
      enabled: definition.enabled,
      builtIn: definition.builtIn,
      available: providerAvailable,
      error: providerError,
      models: [...rawByName.values()]
        .map(model => effectiveModel(definition.name, model))
        .filter(model => model.name)
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true })),
    });
  }

  catalog = result;
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
    ? options.map(entry => ({
      provider: entry.provider,
      models: (entry.models ?? []).filter(model => isModelEnabled(entry.provider, model)),
    })).filter(entry => entry.provider && entry.models.length)
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
  try { await listProviders(); } catch (error) {
    console.warn(`[providers] Rich model discovery failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const byKey = new Map();
  for (const provider of catalog) for (const model of provider.models) byKey.set(`${provider.provider}\u0000${model.name}`, model);
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

const validateProviderName = name => {
  const value = clean(name);
  if (!PROVIDER_NAME_PATTERN.test(value)) throw new Error("Provider name may contain only letters, numbers, hyphens, and underscores");
  return value;
};

const validateBaseUrl = value => {
  const baseUrl = clean(value);
  if (!baseUrl) throw new Error("Provider base URL is required");
  let parsed;
  try { parsed = new URL(baseUrl); } catch { throw new Error("Provider base URL must be a valid URL"); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Provider base URL must use HTTP or HTTPS");
  return baseUrl.replace(/\/+$/, "");
};

const validateProviderDraft = (definition, { existingName = null } = {}) => {
  if (!isObject(definition)) throw new Error("Provider definition must be an object");
  const name = validateProviderName(existingName ?? definition.name);
  const type = clean(definition.type || "ollama").toLowerCase();
  if (type !== "ollama") throw new Error("Carlos Office currently supports Ollama-compatible provider adapters only");
  return {
    name,
    type,
    baseUrl: validateBaseUrl(definition.baseUrl),
    credentialService: clean(definition.credentialService),
    enabled: definition.enabled !== false,
  };
};

const validateRuntimeBinding = normalized => {
  createProviderFromDefinition({
    ...normalized,
    builtIn: normalized.name === "ollama",
  });
};

const touchProviderState = () => {
  catalogLoadedAt = 0;
  notifyOfficeStateChanged(["models", "nora"]);
};

export const registerProvider = async definition => {
  await ensurePreferences();
  const normalized = validateProviderDraft(definition);
  if (isObject(preferences[normalized.name])) throw new Error(`Provider already exists: ${normalized.name}`);
  validateRuntimeBinding(normalized);
  preferences[normalized.name] = {
    type: normalized.type,
    baseUrl: normalized.baseUrl,
    credentialService: normalized.credentialService,
    enabled: normalized.enabled,
    builtIn: false,
    models: {},
  };
  persistPreferences();
  touchProviderState();
  return clone(preferences[normalized.name]);
};

export const updateProvider = async (name, changes) => {
  await ensurePreferences();
  const providerName = validateProviderName(name);
  const current = preferences[providerName];
  if (!isObject(current)) throw new Error(`Unknown provider: ${providerName}`);
  const normalized = validateProviderDraft({ ...current, ...changes, name: providerName }, { existingName: providerName });
  const nora = getNora();
  if (!normalized.enabled && nora?.provider === providerName) {
    throw new Error("Change Nora's default provider before disabling the provider she currently uses");
  }
  validateRuntimeBinding(normalized);
  preferences[providerName] = {
    ...current,
    type: normalized.type,
    baseUrl: normalized.baseUrl,
    credentialService: normalized.credentialService,
    enabled: normalized.enabled,
    builtIn: current.builtIn === true || providerName === "ollama",
    models: isObject(current.models) ? current.models : {},
  };
  persistPreferences();
  touchProviderState();
  return clone(preferences[providerName]);
};

export const deleteProvider = async name => {
  await ensurePreferences();
  const providerName = validateProviderName(name);
  const current = preferences[providerName];
  if (!isObject(current)) return false;
  if (current.builtIn || providerName === "ollama") throw new Error("The built-in ollama provider cannot be deleted; disable or reconfigure it instead");
  const nora = getNora();
  if (nora?.provider === providerName) throw new Error("Change Nora's default provider before removing the provider she currently uses");
  delete preferences[providerName];
  persistPreferences();
  touchProviderState();
  return true;
};

export const testProviderConnection = async definition => {
  const normalized = validateProviderDraft(definition);
  const startedAt = Date.now();
  const instance = createProviderFromDefinition({ ...normalized, builtIn: normalized.name === "ollama" });
  const models = await instance.listModels();
  return {
    ok: true,
    provider: normalized.name,
    baseUrl: normalized.baseUrl,
    latencyMs: Date.now() - startedAt,
    modelCount: models.length,
    models: models.slice(0, 20),
  };
};

export const addProviderModel = async (provider, definition) => {
  if (!isObject(definition)) throw new Error("Model definition must be an object");
  await ensurePreferences();
  const providerName = validateProviderName(provider);
  const known = providerDefinitionsFromSettings(preferences).some(item => item.name === providerName);
  if (!known) throw new Error(`Unknown provider: ${providerName}`);
  const name = clean(definition.name);
  if (!name) throw new Error("Model name is required");
  const location = definition.location === "cloud" ? "cloud" : "local";
  const parameters = definition.parameters == null || definition.parameters === ""
    ? null
    : parseParameterCount(definition.parameters);
  if (definition.parameters != null && definition.parameters !== "" && parameters == null) {
    throw new Error("Model parameters must be a non-negative number or a value such as 8B, 70B, or 1T");
  }
  const supportedCapabilities = Array.isArray(definition.supportedCapabilities)
    ? [...new Set(definition.supportedCapabilities.filter(item => MODEL_CAPABILITIES.includes(item)))]
    : [];
  preferences[providerName] ??= { models: {} };
  preferences[providerName].models ??= {};
  const previous = preferences[providerName].models[name] ?? {};
  preferences[providerName].models[name] = {
    ...previous,
    manual: true,
    location,
    parameters,
    supportedCapabilities,
    enabled: definition.enabled !== false,
    capabilities: {
      ...(isObject(previous.capabilities) ? previous.capabilities : {}),
      ...Object.fromEntries(supportedCapabilities.map(capability => [capability, true])),
    },
  };
  persistPreferences();
  touchProviderState();
  return clone(preferences[providerName].models[name]);
};

export const deleteProviderModel = async (provider, modelName) => {
  await ensurePreferences();
  const providerName = validateProviderName(provider);
  const model = preferences?.[providerName]?.models?.[modelName];
  if (!model?.manual) throw new Error("Only manually registered models can be removed from the registry");
  delete preferences[providerName].models[modelName];
  persistPreferences();
  touchProviderState();
  return true;
};

export const updateModelPreferences = async (provider, modelName, changes) => {
  if (!provider || typeof provider !== "string") throw new Error("Provider is required");
  if (!modelName || typeof modelName !== "string") throw new Error("Model name is required");
  if (!isObject(changes)) throw new Error("Model preference changes must be an object");
  await ensurePreferences();

  let providers;
  try { providers = await listProviders(); } catch { providers = catalog; }
  const current = providers.find(entry => entry.provider === provider)?.models.find(model => model.name === modelName) ?? null;
  if (!current) throw new Error(`Unknown provider model: ${provider}/${modelName}`);

  preferences[provider] ??= { models: {} };
  preferences[provider].models ??= {};
  const previous = preferenceFor(provider, modelName);
  const next = { ...previous };
  const updated = clone(current);

  if (changes.enabled != null) {
    if (typeof changes.enabled !== "boolean") throw new Error("Model enabled must be boolean");
    if (changes.enabled === false) {
      const nora = getNora();
      if (nora?.provider === provider && nora?.model === modelName) throw new Error("Change Nora's default model before disabling the model she currently uses");
    }
    next.enabled = changes.enabled;
    updated.enabled = changes.enabled;
  }

  if (changes.capabilities != null) {
    if (!isObject(changes.capabilities)) throw new Error("Capabilities must be an object");
    next.capabilities = { ...(isObject(previous.capabilities) ? previous.capabilities : {}) };
    for (const [name, enabled] of Object.entries(changes.capabilities)) {
      if (!MODEL_CAPABILITIES.includes(name)) throw new Error(`Unknown model capability: ${name}`);
      if (typeof enabled !== "boolean") throw new Error(`Capability ${name} enabled must be boolean`);
      if (enabled && current.capabilities[name]?.supported !== true) throw new Error(`Model ${modelName} does not report ${name} support`);
      next.capabilities[name] = enabled;
      updated.capabilities[name].enabled = enabled;
    }
  }

  if (changes.costPerMillionTokens != null) {
    if (!isObject(changes.costPerMillionTokens)) throw new Error("Token cost must be an object");
    next.costPerMillionTokens = { ...(isObject(previous.costPerMillionTokens) ? previous.costPerMillionTokens : {}) };
    for (const key of ["inputUsd", "outputUsd"]) {
      if (!Object.prototype.hasOwnProperty.call(changes.costPerMillionTokens, key)) continue;
      const value = changes.costPerMillionTokens[key];
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new Error(`${key} must be a non-negative number or null`);
      next.costPerMillionTokens[key] = value;
      updated.costPerMillionTokens[key] = value;
    }
  }

  preferences[provider].models[modelName] = next;
  persistPreferences();
  touchProviderState();
  return updated;
};

const readJson = async req => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BODY_BYTES) throw new Error(`Provider request body exceeds ${MAX_JSON_BODY_BYTES} bytes`);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
};

export const createProviderResourceController = ({ allowedOrigin, onConfigurationChanged = async () => {} }) => {
  if (!allowedOrigin || typeof allowedOrigin !== "string") throw new Error("Provider controller requires an allowed origin");
  const matches = req => {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    return url.pathname === "/providers" || url.pathname.startsWith("/providers/");
  };
  const handle = async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const parts = partsFrom(url.pathname);
    const method = req.method ?? "GET";
    const origin = req.headers.origin ?? null;
    const cors = {
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    };
    const sendJson = (status, data) => {
      res.writeHead(status, { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(data));
    };
    if (origin && origin !== allowedOrigin) return sendJson(403, { error: "Origin not allowed" });
    if (method === "OPTIONS") {
      res.writeHead(204, cors);
      return res.end();
    }
    const changed = async () => {
      await onConfigurationChanged();
      return listProviders({ refresh: true });
    };
    try {
      if (method === "GET" && parts.length === 1) return sendJson(200, await listProviders({ refresh: url.searchParams.get("refresh") === "1" }));
      if (method === "POST" && parts.length === 2 && parts[1] === "test-connection") {
        return sendJson(200, await testProviderConnection(await readJson(req)));
      }
      if (method === "POST" && parts.length === 1) {
        await registerProvider(await readJson(req));
        return sendJson(201, await changed());
      }
      if (method === "PATCH" && parts.length === 2) {
        await updateProvider(parts[1], await readJson(req));
        return sendJson(200, await changed());
      }
      if (method === "DELETE" && parts.length === 2) {
        const deleted = await deleteProvider(parts[1]);
        return deleted ? sendJson(200, await changed()) : sendJson(404, { error: "Provider not found" });
      }
      if (method === "POST" && parts.length === 3 && parts[2] === "models") {
        await addProviderModel(parts[1], await readJson(req));
        return sendJson(201, await changed());
      }
      if (method === "PATCH" && parts.length === 4 && parts[2] === "models") {
        const updated = await updateModelPreferences(parts[1], parts[3], await readJson(req));
        await onConfigurationChanged();
        return sendJson(200, updated);
      }
      if (method === "DELETE" && parts.length === 4 && parts[2] === "models") {
        await deleteProviderModel(parts[1], parts[3]);
        return sendJson(200, await changed());
      }
      return sendJson(404, { error: "Provider route not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return sendJson(400, { error: message });
    }
  };
  return { matches, handle };
};
