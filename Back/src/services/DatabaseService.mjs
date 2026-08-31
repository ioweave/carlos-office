import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const BACK_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DATABASE_PATH = resolve(BACK_ROOT, ".carlos-office", "carlos-office.db");
export const LEGACY_CREDENTIALS_PATH = resolve(BACK_ROOT, ".carlos-office", "credentials.db");
export const LEGACY_PROVIDER_SETTINGS_PATH = resolve(BACK_ROOT, "ObsidianVault", "System", "providers.json");

const DEFAULT_OLLAMA_URL = "http://localhost:11434/api";
const CAPABILITIES = ["thinking", "vision", "audio", "embeddings"];

const clean = value => typeof value === "string" ? value.trim() : "";
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const boolInt = value => value === true ? 1 : value === false ? 0 : null;

const configureConnection = (db, { initialize = false } = {}) => {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  if (initialize) db.exec("PRAGMA journal_mode = WAL");
  return db;
};

export const openDatabase = (path = DATABASE_PATH, options = {}) => {
  mkdirSync(dirname(path), { recursive: true });
  return configureConnection(new DatabaseSync(path), options);
};

export const withDatabase = (callback, { path = DATABASE_PATH, initialize = false } = {}) => {
  const db = openDatabase(path, { initialize });
  try {
    return callback(db);
  } finally {
    db.close();
  }
};

export const ensureCredentialSchema = db => {
  db.exec(`CREATE TABLE IF NOT EXISTS credentials (
    service TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'bearer',
    allowed_hosts TEXT NOT NULL DEFAULT '[]',
    header_name TEXT,
    scheme TEXT,
    subject TEXT,
    scopes TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
  )`);

  const columns = new Set(db.prepare("PRAGMA table_info(credentials)").all().map(column => column.name));
  if (!columns.has("type")) db.exec("ALTER TABLE credentials ADD COLUMN type TEXT NOT NULL DEFAULT 'bearer'");
  if (!columns.has("allowed_hosts")) db.exec("ALTER TABLE credentials ADD COLUMN allowed_hosts TEXT NOT NULL DEFAULT '[]'");
  if (!columns.has("header_name")) db.exec("ALTER TABLE credentials ADD COLUMN header_name TEXT");
  if (!columns.has("scheme")) db.exec("ALTER TABLE credentials ADD COLUMN scheme TEXT");
  if (!columns.has("subject")) db.exec("ALTER TABLE credentials ADD COLUMN subject TEXT");
  if (!columns.has("scopes")) db.exec("ALTER TABLE credentials ADD COLUMN scopes TEXT NOT NULL DEFAULT '[]'");
};

const ensureProviderSchema = db => {
  db.exec(`CREATE TABLE IF NOT EXISTS providers (
    name TEXT PRIMARY KEY,
    adapter TEXT NOT NULL,
    base_url TEXT NOT NULL,
    credential_service TEXT,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    built_in INTEGER NOT NULL DEFAULT 0 CHECK (built_in IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (credential_service) REFERENCES credentials(service) ON DELETE SET NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS provider_models (
    provider_name TEXT NOT NULL,
    model TEXT NOT NULL,
    manual INTEGER NOT NULL DEFAULT 0 CHECK (manual IN (0, 1)),
    location TEXT CHECK (location IN ('local', 'cloud') OR location IS NULL),
    parameters INTEGER,
    enabled INTEGER CHECK (enabled IN (0, 1) OR enabled IS NULL),
    input_cost REAL,
    output_cost REAL,
    PRIMARY KEY (provider_name, model),
    FOREIGN KEY (provider_name) REFERENCES providers(name) ON DELETE CASCADE
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS provider_model_capabilities (
    provider_name TEXT NOT NULL,
    model TEXT NOT NULL,
    capability TEXT NOT NULL,
    supported INTEGER CHECK (supported IN (0, 1) OR supported IS NULL),
    enabled INTEGER CHECK (enabled IN (0, 1) OR enabled IS NULL),
    PRIMARY KEY (provider_name, model, capability),
    FOREIGN KEY (provider_name, model) REFERENCES provider_models(provider_name, model) ON DELETE CASCADE
  )`);
};

const ensureMetaSchema = db => {
  db.exec(`CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
};

const meta = (db, key) => db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key)?.value ?? null;
const setMeta = (db, key, value = new Date().toISOString()) => {
  db.prepare(`INSERT INTO app_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
};

const normalizeBaseUrl = value => {
  const raw = clean(value) || DEFAULT_OLLAMA_URL;
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return DEFAULT_OLLAMA_URL;
    return raw.replace(/\/+$/, "");
  } catch {
    return DEFAULT_OLLAMA_URL;
  }
};

const hostForUrl = value => {
  try { return new URL(value).hostname.toLowerCase(); } catch { return null; }
};

const insertCredentialIfMissing = (db, { service, token, baseUrl }) => {
  const secret = clean(token);
  const host = hostForUrl(baseUrl);
  if (!secret || !host) return null;
  const updatedAt = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO credentials (
    service, token, type, allowed_hosts, header_name, scheme, subject, scopes, updated_at
  ) VALUES (?, ?, 'bearer', ?, 'Authorization', 'Bearer', NULL, '[]', ?)`)
    .run(service, secret, JSON.stringify([host]), updatedAt);
  return service;
};

const insertProvider = (db, {
  name,
  adapter = "ollama",
  baseUrl,
  credentialService = null,
  enabled = true,
  builtIn = false,
}) => {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO providers (
    name, adapter, base_url, credential_service, enabled, built_in, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(name) DO UPDATE SET
    adapter = excluded.adapter,
    base_url = excluded.base_url,
    credential_service = COALESCE(providers.credential_service, excluded.credential_service),
    enabled = excluded.enabled,
    built_in = MAX(providers.built_in, excluded.built_in),
    updated_at = excluded.updated_at`)
    .run(name, adapter, normalizeBaseUrl(baseUrl), credentialService, enabled ? 1 : 0, builtIn ? 1 : 0, now, now);
};

const insertModelPreference = (db, providerName, modelName, preference = {}) => {
  if (!clean(modelName) || !isObject(preference)) return;
  const location = preference.location === "cloud" ? "cloud" : preference.location === "local" ? "local" : null;
  const parameters = Number.isFinite(Number(preference.parameters)) && Number(preference.parameters) >= 0
    ? Math.round(Number(preference.parameters))
    : null;
  const enabled = typeof preference.enabled === "boolean" ? (preference.enabled ? 1 : 0) : null;
  const pricing = isObject(preference.costPerMillionTokens) ? preference.costPerMillionTokens : {};
  const inputCost = Number.isFinite(Number(pricing.inputUsd)) && Number(pricing.inputUsd) >= 0 ? Number(pricing.inputUsd) : null;
  const outputCost = Number.isFinite(Number(pricing.outputUsd)) && Number(pricing.outputUsd) >= 0 ? Number(pricing.outputUsd) : null;

  db.prepare(`INSERT INTO provider_models (
    provider_name, model, manual, location, parameters, enabled, input_cost, output_cost
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(provider_name, model) DO UPDATE SET
    manual = excluded.manual,
    location = COALESCE(excluded.location, provider_models.location),
    parameters = COALESCE(excluded.parameters, provider_models.parameters),
    enabled = COALESCE(excluded.enabled, provider_models.enabled),
    input_cost = COALESCE(excluded.input_cost, provider_models.input_cost),
    output_cost = COALESCE(excluded.output_cost, provider_models.output_cost)`)
    .run(providerName, modelName, preference.manual ? 1 : 0, location, parameters, enabled, inputCost, outputCost);

  const supported = new Set(Array.isArray(preference.supportedCapabilities) ? preference.supportedCapabilities : []);
  const enabledCapabilities = isObject(preference.capabilities) ? preference.capabilities : {};
  for (const capability of CAPABILITIES) {
    const hasSupported = supported.has(capability);
    const hasEnabled = typeof enabledCapabilities[capability] === "boolean";
    if (!hasSupported && !hasEnabled) continue;
    db.prepare(`INSERT INTO provider_model_capabilities (
      provider_name, model, capability, supported, enabled
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(provider_name, model, capability) DO UPDATE SET
      supported = COALESCE(excluded.supported, provider_model_capabilities.supported),
      enabled = COALESCE(excluded.enabled, provider_model_capabilities.enabled)`)
      .run(providerName, modelName, capability, hasSupported ? 1 : null, hasEnabled ? boolInt(enabledCapabilities[capability]) : null);
  }
};

const migrateLegacyCredentials = db => {
  if (meta(db, "migration.credentials_db.v1")) return;
  if (!existsSync(LEGACY_CREDENTIALS_PATH) || resolve(LEGACY_CREDENTIALS_PATH) === resolve(DATABASE_PATH)) {
    setMeta(db, "migration.credentials_db.v1", "absent");
    return;
  }

  const legacy = configureConnection(new DatabaseSync(LEGACY_CREDENTIALS_PATH));
  try {
    ensureCredentialSchema(legacy);
    const rows = legacy.prepare("SELECT * FROM credentials").all();
    const insert = db.prepare(`INSERT OR IGNORE INTO credentials (
      service, token, type, allowed_hosts, header_name, scheme, subject, scopes, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const row of rows) {
      insert.run(
        row.service,
        row.token,
        row.type ?? "bearer",
        row.allowed_hosts ?? "[]",
        row.header_name ?? null,
        row.scheme ?? null,
        row.subject ?? null,
        row.scopes ?? "[]",
        row.updated_at ?? new Date().toISOString(),
      );
    }
    setMeta(db, "migration.credentials_db.v1", String(rows.length));
  } finally {
    legacy.close();
  }
};

const migrateLegacyProviders = db => {
  if (meta(db, "migration.providers_json.v1")) return;

  let settings = {};
  if (existsSync(LEGACY_PROVIDER_SETTINGS_PATH)) {
    try {
      const parsed = JSON.parse(readFileSync(LEGACY_PROVIDER_SETTINGS_PATH, "utf8"));
      if (isObject(parsed)) settings = parsed;
    } catch (error) {
      console.warn(`[database] Could not read legacy providers.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const names = new Set(Object.keys(settings));
  names.add("ollama");
  for (const name of names) {
    const stored = isObject(settings[name]) ? settings[name] : {};
    const baseUrl = normalizeBaseUrl(
      stored.baseUrl
      || (name === "ollama" ? process.env.OLLAMA_BASE_URL : null)
      || DEFAULT_OLLAMA_URL,
    );
    const adapter = clean(stored.type) || "ollama";
    if (adapter !== "ollama") continue;

    let credentialService = null;
    const envName = clean(stored.apiKeyEnv) || (name === "ollama" ? "OLLAMA_API_KEY" : "");
    if (envName && clean(process.env[envName])) {
      credentialService = insertCredentialIfMissing(db, {
        service: `provider:${name}`,
        token: process.env[envName],
        baseUrl,
      });
    }

    insertProvider(db, {
      name,
      adapter,
      baseUrl,
      credentialService,
      enabled: stored.enabled !== false,
      builtIn: name === "ollama",
    });

    const models = isObject(stored.models) ? stored.models : {};
    for (const [modelName, preference] of Object.entries(models)) {
      insertModelPreference(db, name, modelName, preference);
    }
  }

  setMeta(db, "migration.providers_json.v1", existsSync(LEGACY_PROVIDER_SETTINGS_PATH) ? "imported" : "absent");
};

const ensureBuiltInOllama = db => {
  const current = db.prepare("SELECT name FROM providers WHERE name = 'ollama'").get();
  if (current) return;
  const baseUrl = normalizeBaseUrl(process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL);
  const credentialService = clean(process.env.OLLAMA_API_KEY)
    ? insertCredentialIfMissing(db, { service: "provider:ollama", token: process.env.OLLAMA_API_KEY, baseUrl })
    : null;
  insertProvider(db, { name: "ollama", baseUrl, credentialService, builtIn: true });
};

export const initializeDatabase = () => withDatabase(db => {
  ensureMetaSchema(db);
  ensureCredentialSchema(db);
  ensureProviderSchema(db);

  db.exec("BEGIN IMMEDIATE");
  try {
    migrateLegacyCredentials(db);
    migrateLegacyProviders(db);
    ensureBuiltInOllama(db);
    setMeta(db, "schema.version", "1");
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch (rollbackError) {
      console.error("[database] Could not roll back failed initialization.", {
        message: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      });
    }
    throw error;
  }

  return { path: DATABASE_PATH, schemaVersion: 1 };
}, { initialize: true });

export const databaseInfo = () => ({ path: DATABASE_PATH, ignoredDirectory: resolve(BACK_ROOT, ".carlos-office") });
