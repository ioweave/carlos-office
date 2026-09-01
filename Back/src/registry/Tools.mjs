import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { recordEvent } from "../controllers/EventController.mjs";
import { atomicWriteFile } from "../lib/AtomicFile.mjs";
import { notifyOfficeStateChanged } from "../services/OfficeStateBus.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const toolsDir = resolve(here, "../../tools");
const tools = new Map();
const CANDIDATE_PREFIX = ".candidate-";
let registryRevision = 0;

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

const normalizeInputSchema = input => {
  if (!isObject(input)) return input;
  const schema = structuredClone(input);
  schema.required ??= [];
  schema.properties ??= {};
  schema.additionalProperties ??= false;
  return schema;
};

const normalizeTool = (module, expectedName = null) => {
  let tool = module.default ?? module.tool ?? {};
  if (typeof tool === "function") tool = { execute: tool };
  if (!tool || typeof tool !== "object") return tool;

  const { inputSchema, parameters, ...normalized } = tool;
  normalized.name ??= expectedName;
  normalized.execute ??= module.execute;
  normalized.input = normalizeInputSchema(tool.input ?? inputSchema ?? parameters);
  return normalized;
};

const validateTool = (tool, filename, expectedName = null) => {
  if (!tool || typeof tool !== "object") throw new Error(`Invalid Tool: ${filename}`);
  if (!tool.name || typeof tool.name !== "string") throw new Error(`Tool ${filename} must have a name`);
  if (expectedName && tool.name !== expectedName) throw new Error(`Tool source declares ${tool.name}, expected ${expectedName}`);
  if (typeof tool.execute !== "function") throw new Error(`Tool ${tool.name} must export an execute function`);
  if (!isObject(tool.input) || tool.input.type !== "object") {
    throw new Error(`Tool ${tool.name} input must be a JSON Schema object with type "object"`);
  }
  if (!isObject(tool.input.properties)) throw new Error(`Tool ${tool.name} input.properties must be an object`);
  if (!Array.isArray(tool.input.required) || tool.input.required.some(name => typeof name !== "string" || !name)) {
    throw new Error(`Tool ${tool.name} input.required must be an array of property names`);
  }
  for (const name of tool.input.required) {
    if (!Object.prototype.hasOwnProperty.call(tool.input.properties, name)) {
      throw new Error(`Tool ${tool.name} requires undefined input property: ${name}`);
    }
  }
  if (typeof tool.input.additionalProperties !== "boolean") {
    throw new Error(`Tool ${tool.name} input.additionalProperties must be a boolean`);
  }
  for (const [name, property] of Object.entries(tool.input.properties)) {
    if (!isObject(property)) throw new Error(`Tool ${tool.name} input property ${name} must be a schema object`);
  }
};

const importTool = async (path, filename, expectedName = null) => {
  const module = await import(`${pathToFileURL(path).href}?t=${Date.now()}-${randomUUID()}`);
  const tool = normalizeTool(module, expectedName);
  validateTool(tool, filename, expectedName);
  return tool;
};

const recordLoadFailure = async (filename, error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[tools] Could not load Tool.", { filename, message });
  try {
    await recordEvent("tool.load_failed", { filename, error: message });
  } catch (eventError) {
    console.error("[tools] Could not record Tool load failure.", {
      filename,
      message: eventError instanceof Error ? eventError.message : String(eventError),
    });
  }
};

const publishRegistry = discovered => {
  tools.clear();
  for (const [name, tool] of discovered) tools.set(name, tool);
  registryRevision += 1;
  notifyOfficeStateChanged("toolsRevision");
};

export const loadTools = async () => {
  await mkdir(toolsDir, { recursive: true });
  const files = await readdir(toolsDir);
  const filenames = files.filter(file => file.endsWith(".mjs") && !file.startsWith(CANDIDATE_PREFIX));
  const discovered = new Map();

  for (const filename of filenames) {
    try {
      const expectedName = filename.slice(0, -4);
      const tool = await importTool(resolve(toolsDir, filename), filename, expectedName);
      if (discovered.has(tool.name)) throw new Error(`Duplicate Tool name: ${tool.name}`);
      discovered.set(tool.name, tool);
    } catch (error) {
      await recordLoadFailure(filename, error);
    }
  }

  // Never destroy a healthy live registry because a reload pass produced nothing.
  if (discovered.size || !tools.size || !filenames.length) publishRegistry(discovered);
  else console.error("[tools] Reload produced no valid Tools; preserving the previous registry.");
  return tools;
};

export const getTool = name => tools.get(name) ?? null;
export const listTools = () => [...tools.values()];
export const getToolsRevision = () => registryRevision;

export const saveTool = async (name, source) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`Invalid Tool name: ${name}`);
  if (typeof source !== "string" || !source.trim()) throw new Error("Tool source must be a non-empty string");

  await mkdir(toolsDir, { recursive: true });
  const livePath = resolve(toolsDir, `${name}.mjs`);
  const candidateFilename = `${CANDIDATE_PREFIX}${name}-${randomUUID()}.mjs`;
  const candidatePath = resolve(toolsDir, candidateFilename);
  let previousSource = null;
  let hadPreviousSource = true;

  try {
    try {
      previousSource = await readFile(livePath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      hadPreviousSource = false;
    }

    await writeFile(candidatePath, source, "utf8");
    await importTool(candidatePath, candidateFilename, name);
    await atomicWriteFile(livePath, source, "utf8");

    try {
      const liveTool = await importTool(livePath, `${name}.mjs`, name);
      tools.set(name, liveTool);
      registryRevision += 1;
      notifyOfficeStateChanged("toolsRevision");
      return liveTool;
    } catch (error) {
      if (hadPreviousSource) await atomicWriteFile(livePath, previousSource, "utf8");
      else await rm(livePath, { force: true });
      throw error;
    }
  } finally {
    await rm(candidatePath, { force: true });
  }
};

export const deleteTool = async name => {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`Invalid Tool name: ${name}`);
  if (!tools.has(name)) return false;
  await rm(resolve(toolsDir, `${name}.mjs`), { force: true });
  tools.delete(name);
  registryRevision += 1;
  notifyOfficeStateChanged("toolsRevision");
  await recordEvent("tool.deleted", { tool: name });
  return true;
};

export const readToolSource = async name => {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`Invalid Tool name: ${name}`);
  return readFile(resolve(toolsDir, `${name}.mjs`), "utf8");
};
