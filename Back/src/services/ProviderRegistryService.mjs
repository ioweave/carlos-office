import { withDatabase } from "./DatabaseService.mjs";

const CAPABILITIES = ["thinking", "vision", "audio", "embeddings"];
const clean = value => typeof value === "string" ? value.trim() : "";
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const boolFromDb = value => value === 1 ? true : value === 0 ? false : null;

const modelPreferenceFromRows = (modelRow, capabilityRows) => {
  const preference = {};
  if (modelRow.manual) preference.manual = true;
  if (modelRow.location) preference.location = modelRow.location;
  if (modelRow.parameters != null) preference.parameters = Number(modelRow.parameters);
  if (modelRow.enabled != null) preference.enabled = Boolean(modelRow.enabled);
  if (modelRow.inference_timeout_ms != null) preference.inferenceTimeoutMs = Number(modelRow.inference_timeout_ms);
  if (modelRow.input_cost != null || modelRow.output_cost != null) {
    preference.costPerMillionTokens = {
      inputUsd: modelRow.input_cost == null ? null : Number(modelRow.input_cost),
      outputUsd: modelRow.output_cost == null ? null : Number(modelRow.output_cost),
    };
  }

  const supportedCapabilities = capabilityRows
    .filter(row => row.supported === 1)
    .map(row => row.capability);
  if (supportedCapabilities.length) preference.supportedCapabilities = supportedCapabilities;

  const capabilities = {};
  for (const row of capabilityRows) {
    const enabled = boolFromDb(row.enabled);
    if (enabled != null) capabilities[row.capability] = enabled;
  }
  if (Object.keys(capabilities).length) preference.capabilities = capabilities;
  return preference;
};

export const loadProviderSettings = () => withDatabase(db => {
  const providers = db.prepare(`SELECT name, adapter, base_url, credential_service, enabled, built_in
    FROM providers ORDER BY name`).all();
  const modelRows = db.prepare(`SELECT provider_name, model, manual, location, parameters, enabled,
      inference_timeout_ms, input_cost, output_cost
    FROM provider_models ORDER BY provider_name, model`).all();
  const capabilityRows = db.prepare(`SELECT provider_name, model, capability, supported, enabled
    FROM provider_model_capabilities ORDER BY provider_name, model, capability`).all();

  const modelsByProvider = new Map();
  const capabilitiesByModel = new Map();
  for (const row of capabilityRows) {
    const key = `${row.provider_name}\u0000${row.model}`;
    if (!capabilitiesByModel.has(key)) capabilitiesByModel.set(key, []);
    capabilitiesByModel.get(key).push(row);
  }
  for (const row of modelRows) {
    if (!modelsByProvider.has(row.provider_name)) modelsByProvider.set(row.provider_name, {});
    const key = `${row.provider_name}\u0000${row.model}`;
    modelsByProvider.get(row.provider_name)[row.model] = modelPreferenceFromRows(row, capabilitiesByModel.get(key) ?? []);
  }

  return Object.fromEntries(providers.map(row => [row.name, {
    type: row.adapter,
    baseUrl: row.base_url,
    credentialService: row.credential_service || "",
    enabled: Boolean(row.enabled),
    builtIn: Boolean(row.built_in),
    models: modelsByProvider.get(row.name) ?? {},
  }]));
});

const normalizeProvider = (name, raw) => {
  const providerName = clean(name);
  if (!providerName) throw new Error("Provider name is required");
  if (!isObject(raw)) throw new Error(`Provider ${providerName} settings must be an object`);
  const type = clean(raw.type || "ollama").toLowerCase();
  if (type !== "ollama") throw new Error(`Unsupported provider adapter: ${type}`);
  const baseUrl = clean(raw.baseUrl);
  if (!baseUrl) throw new Error(`Provider ${providerName} base URL is required`);
  return {
    name: providerName,
    type,
    baseUrl,
    credentialService: clean(raw.credentialService),
    enabled: raw.enabled !== false,
    builtIn: raw.builtIn === true || providerName === "ollama",
    models: isObject(raw.models) ? raw.models : {},
  };
};

const nullableNumber = value => {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};
const nullableInteger = value => {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
};

export const replaceProviderSettings = settings => {
  if (!isObject(settings)) throw new Error("Provider settings must be an object");
  const normalized = Object.entries(settings).map(([name, value]) => normalizeProvider(name, value));
  if (!normalized.some(provider => provider.name === "ollama")) {
    throw new Error("The built-in ollama provider must remain registered");
  }

  return withDatabase(db => {
    const credentials = new Set(db.prepare("SELECT service FROM credentials").all().map(row => row.service));
    for (const provider of normalized) {
      if (provider.credentialService && !credentials.has(provider.credentialService)) {
        throw new Error(`Provider ${provider.name} references unknown credential: ${provider.credentialService}`);
      }
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("DELETE FROM providers");
      const now = new Date().toISOString();
      const insertProvider = db.prepare(`INSERT INTO providers (
        name, adapter, base_url, credential_service, enabled, built_in, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      const insertModel = db.prepare(`INSERT INTO provider_models (
        provider_name, model, manual, location, parameters, enabled, inference_timeout_ms, input_cost, output_cost
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const insertCapability = db.prepare(`INSERT INTO provider_model_capabilities (
        provider_name, model, capability, supported, enabled
      ) VALUES (?, ?, ?, ?, ?)`);

      for (const provider of normalized) {
        insertProvider.run(
          provider.name,
          provider.type,
          provider.baseUrl,
          provider.credentialService || null,
          provider.enabled ? 1 : 0,
          provider.builtIn ? 1 : 0,
          now,
          now,
        );

        for (const [modelNameRaw, preferenceRaw] of Object.entries(provider.models)) {
          const modelName = clean(modelNameRaw);
          if (!modelName || !isObject(preferenceRaw)) continue;
          const preference = preferenceRaw;
          const location = preference.location === "cloud" ? "cloud" : preference.location === "local" ? "local" : null;
          const parameters = nullableNumber(preference.parameters);
          const enabled = typeof preference.enabled === "boolean" ? (preference.enabled ? 1 : 0) : null;
          const pricing = isObject(preference.costPerMillionTokens) ? preference.costPerMillionTokens : {};
          insertModel.run(
            provider.name,
            modelName,
            preference.manual ? 1 : 0,
            location,
            parameters == null ? null : Math.round(parameters),
            enabled,
            nullableInteger(preference.inferenceTimeoutMs),
            nullableNumber(pricing.inputUsd),
            nullableNumber(pricing.outputUsd),
          );

          const supported = new Set(Array.isArray(preference.supportedCapabilities) ? preference.supportedCapabilities : []);
          const enabledCapabilities = isObject(preference.capabilities) ? preference.capabilities : {};
          for (const capability of CAPABILITIES) {
            const supportValue = supported.has(capability) ? 1 : null;
            const enabledValue = typeof enabledCapabilities[capability] === "boolean"
              ? (enabledCapabilities[capability] ? 1 : 0)
              : null;
            if (supportValue == null && enabledValue == null) continue;
            insertCapability.run(provider.name, modelName, capability, supportValue, enabledValue);
          }
        }
      }

      db.exec("COMMIT");
      return loadProviderSettings();
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch (rollbackError) {
        console.error("[providers] Could not roll back provider settings.", {
          message: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        });
      }
      throw error;
    }
  });
};

export const listCredentialChoices = () => withDatabase(db => db.prepare(`SELECT service, type, allowed_hosts, updated_at
  FROM credentials ORDER BY service`).all().map(row => ({
  service: row.service,
  type: row.type,
  allowedHosts: (() => {
    try {
      const parsed = JSON.parse(row.allowed_hosts || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })(),
  updatedAt: row.updated_at,
})));
