import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { getVariable } from "./VariableService.mjs";

const PLUGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DEFAULT_PLUGINS_ROOT = resolve(homedir(), ".carlos-office", "plugins");
const here = dirname(fileURLToPath(import.meta.url));
const LEGACY_INTEGRATIONS_ROOT = resolve(here, "../../.carlos-office/integrations");
const MANIFEST_FILE = "plugin.json";

const clean = value => typeof value === "string" ? value.trim() : "";
const configured = key => key ? clean(getVariable(key)?.value) : "";
const pathExists = async path => {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
};
const pluginError = (message, code, hint = null) => {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  if (hint) error.hint = hint;
  return error;
};
const validateName = name => {
  const normalized = clean(name).toLowerCase();
  if (!PLUGIN_NAME_PATTERN.test(normalized)) throw pluginError(`Invalid Plugin name: ${name}`, "plugin_invalid_name");
  return normalized;
};
const resolveInsidePlugin = (home, value, label) => {
  const target = resolve(home, value);
  const child = relative(home, target);
  if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw pluginError(`${label} must stay inside Plugin directory`, "plugin_manifest_invalid");
  }
  return target;
};
const normalizeExecutable = (home, value) => {
  const executable = clean(value);
  if (!executable) return "";
  if (isAbsolute(executable)) return executable;
  if (executable.startsWith(".") || executable.includes("/") || executable.includes("\\")) {
    return resolveInsidePlugin(home, executable, "Plugin command");
  }
  return executable;
};

const readManifest = async (home, expectedName) => {
  const manifestPath = resolve(home, MANIFEST_FILE);
  let source;
  try { source = await readFile(manifestPath, "utf8"); } catch (error) {
    if (error.code === "ENOENT") {
      return {
        manifestPath: null,
        manifest: { name: expectedName, version: null, type: "command", command: null, entrypoint: null },
      };
    }
    throw error;
  }

  let manifest;
  try { manifest = JSON.parse(source); } catch (error) {
    throw pluginError(`Plugin ${expectedName} has invalid ${MANIFEST_FILE}: ${error.message}`, "plugin_manifest_invalid");
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw pluginError(`Plugin ${expectedName} manifest must be one JSON object`, "plugin_manifest_invalid");
  }
  const name = validateName(manifest.name || expectedName);
  if (name !== expectedName) {
    throw pluginError(`Plugin manifest declares ${name}, expected ${expectedName}`, "plugin_manifest_invalid");
  }
  const type = clean(manifest.type || "command").toLowerCase();
  if (type !== "command") throw pluginError(`Unsupported Plugin type: ${type}`, "plugin_manifest_invalid");
  if (manifest.command != null && !clean(manifest.command)) {
    throw pluginError(`Plugin ${name} command must be a non-empty string`, "plugin_manifest_invalid");
  }
  if (manifest.entrypoint != null && !clean(manifest.entrypoint)) {
    throw pluginError(`Plugin ${name} entrypoint must be a non-empty string`, "plugin_manifest_invalid");
  }

  return {
    manifestPath,
    manifest: {
      name,
      version: clean(manifest.version) || null,
      type,
      command: clean(manifest.command) || null,
      entrypoint: clean(manifest.entrypoint) || null,
      description: clean(manifest.description) || null,
    },
  };
};

const loadPlugin = async (name, home, source) => {
  const { manifest, manifestPath } = await readManifest(home, name);
  return { name, home, source, manifestPath, manifest };
};

export const getPluginsRoot = () => {
  const configuredRoot = configured("plugin.rootPath") || clean(process.env.CARLOS_OFFICE_PLUGINS_DIR);
  return resolve(configuredRoot || DEFAULT_PLUGINS_ROOT);
};

export const resolvePlugin = async (name, {
  legacyNames = [],
  legacyPathVariable = null,
  envPathVariable = null,
  required = true,
} = {}) => {
  const pluginName = validateName(name);
  const explicitPath = configured(`plugin.${pluginName}.path`)
    || configured(legacyPathVariable)
    || clean(envPathVariable ? process.env[envPathVariable] : "");
  if (explicitPath) {
    const home = resolve(explicitPath);
    if (!await pathExists(home)) {
      throw pluginError(
        `Plugin ${pluginName} path does not exist: ${home}`,
        "plugin_not_installed",
        `Install the Plugin or correct plugin.${pluginName}.path.`,
      );
    }
    return loadPlugin(pluginName, home, "configured");
  }

  const home = resolve(getPluginsRoot(), pluginName);
  if (await pathExists(home)) return loadPlugin(pluginName, home, "plugins-root");

  for (const legacyName of legacyNames) {
    const legacyHome = resolve(LEGACY_INTEGRATIONS_ROOT, legacyName);
    if (await pathExists(legacyHome)) return loadPlugin(pluginName, legacyHome, "legacy-integration");
  }

  if (!required) return null;
  throw pluginError(
    `Plugin ${pluginName} is not installed`,
    "plugin_not_installed",
    `Install it under ${home} or set plugin.${pluginName}.path.`,
  );
};

export const resolvePluginEntrypoint = (plugin, fallback = null) => {
  if (!plugin?.home) throw pluginError("Plugin home is required", "plugin_invalid_runtime");
  const entrypoint = clean(plugin.manifest?.entrypoint) || clean(fallback);
  return entrypoint ? resolveInsidePlugin(plugin.home, entrypoint, "Plugin entrypoint") : null;
};

export const resolvePluginExecutable = (pluginOrName, {
  sharedVariableKey = null,
  legacyVariableKey = null,
  envVariable = null,
  fallback = "",
} = {}) => {
  const plugin = typeof pluginOrName === "string"
    ? { name: validateName(pluginOrName), home: getPluginsRoot(), manifest: {} }
    : pluginOrName;
  if (!plugin?.name) throw pluginError("Plugin name is required", "plugin_invalid_runtime");
  const value = configured(`plugin.${plugin.name}.command`)
    || clean(plugin.manifest?.command)
    || configured(sharedVariableKey)
    || configured(legacyVariableKey)
    || clean(envVariable ? process.env[envVariable] : "")
    || clean(fallback);
  if (!value) throw pluginError(`Plugin ${plugin.name} has no executable command`, "plugin_command_missing");
  return normalizeExecutable(plugin.home || getPluginsRoot(), value);
};

export const listInstalledPlugins = async () => {
  const root = getPluginsRoot();
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const plugins = [];
  for (const entry of entries.filter(item => item.isDirectory())) {
    let name;
    try { name = validateName(entry.name); } catch { continue; }
    try { plugins.push(await loadPlugin(name, resolve(root, entry.name), "plugins-root")); } catch (error) {
      plugins.push({ name, home: resolve(root, entry.name), source: "plugins-root", error: error.message });
    }
  }
  return plugins.sort((left, right) => left.name.localeCompare(right.name));
};
