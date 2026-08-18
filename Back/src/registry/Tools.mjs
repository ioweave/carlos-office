import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const toolsDir = resolve(here, "../../tools");

const tools = new Map();

function validateTool(tool, filename) {
  if (!tool || typeof tool !== "object") {
    throw new Error(`Invalid tool: ${filename}`);
  }

  if (!tool.name || typeof tool.name !== "string") {
    throw new Error(`Tool ${filename} must have a name`);
  }

  if (typeof tool.execute !== "function") {
    throw new Error(`Tool ${tool.name} must export an execute function`);
  }
}

export async function loadTools() {
  await mkdir(toolsDir, { recursive: true });

  tools.clear();

  const files = await readdir(toolsDir);

  for (const filename of files.filter((file) => file.endsWith(".mjs"))) {
    const path = resolve(toolsDir, filename);
    const module = await import(`${pathToFileURL(path).href}?t=${Date.now()}`);

    const tool = module.default ?? module.tool;

    validateTool(tool, filename);

    if (tools.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }

    tools.set(tool.name, tool);
  }

  return tools;
}

export function getTool(name) {
  return tools.get(name) ?? null;
}

export function listTools() {
  return [...tools.values()];
}

export async function saveTool(name, source) {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid tool name: ${name}`);
  }

  if (typeof source !== "string" || !source.trim()) {
    throw new Error("Tool source must be a non-empty string");
  }

  await mkdir(toolsDir, { recursive: true });

  const path = resolve(toolsDir, `${name}.mjs`);

  await writeFile(path, source, "utf8");
  await loadTools();

  return getTool(name);
}

export async function readToolSource(name) {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid tool name: ${name}`);
  }

  return readFile(resolve(toolsDir, `${name}.mjs`), "utf8");
}