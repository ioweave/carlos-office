import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const toolsDir = resolve(here, "../../tools");
const tools = new Map();
const CANDIDATE_PREFIX = ".candidate-";

const validateTool = (tool, filename, expectedName = null) => {
  if (!tool || typeof tool !== "object") throw new Error(`Invalid tool: ${filename}`);
  if (!tool.name || typeof tool.name !== "string") throw new Error(`Tool ${filename} must have a name`);
  if (expectedName && tool.name !== expectedName) {
    throw new Error(`Tool source declares ${tool.name}, expected ${expectedName}`);
  }
  if (typeof tool.execute !== "function") throw new Error(`Tool ${tool.name} must export an execute function`);
};

const importTool = async (path, filename, expectedName = null) => {
  const module = await import(`${pathToFileURL(path).href}?t=${Date.now()}-${randomUUID()}`);
  const tool = module.default ?? module.tool;
  validateTool(tool, filename, expectedName);
  return tool;
};

export const loadTools = async () => {
  await mkdir(toolsDir, { recursive: true });
  tools.clear();

  const files = await readdir(toolsDir);
  for (const filename of files.filter(file => file.endsWith(".mjs") && !file.startsWith(CANDIDATE_PREFIX))) {
    const tool = await importTool(resolve(toolsDir, filename), filename);
    if (tools.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
    tools.set(tool.name, tool);
  }

  return tools;
};

export const getTool = name => tools.get(name) ?? null;

export const listTools = () => [...tools.values()];

export const saveTool = async (name, source) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`Invalid tool name: ${name}`);
  if (typeof source !== "string" || !source.trim()) throw new Error("Tool source must be a non-empty string");

  await mkdir(toolsDir, { recursive: true });

  const livePath = resolve(toolsDir, `${name}.mjs`);
  const candidateFilename = `${CANDIDATE_PREFIX}${name}-${randomUUID()}.mjs`;
  const candidatePath = resolve(toolsDir, candidateFilename);

  try {
    await writeFile(candidatePath, source, "utf8");
    const tool = await importTool(candidatePath, candidateFilename, name);

    await writeFile(livePath, source, "utf8");
    tools.set(name, tool);
    return tool;
  } finally {
    await rm(candidatePath, { force: true });
  }
};

export const readToolSource = async name => {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`Invalid tool name: ${name}`);
  return readFile(resolve(toolsDir, `${name}.mjs`), "utf8");
};