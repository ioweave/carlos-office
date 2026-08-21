import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const agentsDir = resolve(here, "../../ObsidianVault/90-System/Agents");
const definitions = new Map();

const validateName = name => {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`Invalid agent name: ${name}`);
};

const parseList = (content, key) => {
  const value = content.match(new RegExp(`^${key}:\\s*(.+)$`, "im"))?.[1]?.trim();
  if (!value) return [];

  if (value.startsWith("[")) {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some(item => typeof item !== "string" || !item.trim())) {
      throw new Error(`Agent ${key} must be a list of names`);
    }
    return parsed.map(item => item.trim());
  }

  return value.split(",").map(item => item.trim()).filter(Boolean);
};

const parseDefinition = (name, path, content) => {
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`Agent ${name} must contain configuration or instructions`);
  }

  return {
    name,
    path,
    provider: content.match(/^provider:\s*(.+)$/im)?.[1]?.trim() || null,
    model: content.match(/^model:\s*(.+)$/im)?.[1]?.trim() || null,
    tools: parseList(content, "tools"),
    skills: parseList(content, "skills"),
    instructions: content
      .split(/\r?\n/)
      .filter(line => !/^\s*(provider|model|tools|skills):\s*/i.test(line))
      .join("\n")
      .trim(),
    isNora: name.toLowerCase() === "nora",
  };
};

const renderDefinition = definition => {
  const lines = [];
  if (definition.provider) lines.push(`provider: ${definition.provider}`);
  if (definition.model) lines.push(`model: ${definition.model}`);
  if (definition.tools?.length) lines.push(`tools: ${definition.tools.join(", ")}`);
  if (definition.skills?.length) lines.push(`skills: ${definition.skills.join(", ")}`);
  if (definition.instructions) lines.push("", definition.instructions.trim());
  return `${lines.join("\n").trim()}\n`;
};

export const loadAgents = async () => {
  await mkdir(agentsDir, { recursive: true });
  definitions.clear();

  const files = await readdir(agentsDir);
  for (const filename of files.filter(file => file.endsWith(".md"))) {
    const path = resolve(agentsDir, filename);
    const name = basename(filename, ".md");
    const definition = parseDefinition(name, path, await readFile(path, "utf8"));
    if (definitions.has(name)) throw new Error(`Duplicate Agent definition: ${name}`);
    definitions.set(name, definition);
  }

  return listAgents();
};

export const getAgent = name => {
  const definition = definitions.get(name);
  return definition ? structuredClone(definition) : null;
};

export const listAgents = () => [...definitions.values()].map(definition => structuredClone(definition));

export const getNora = () => {
  const definition = [...definitions.values()].find(item => item.isNora) ?? null;
  return definition ? structuredClone(definition) : null;
};

export const saveAgent = async (name, content) => {
  validateName(name);
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`Agent ${name} must contain configuration or instructions`);
  }

  await mkdir(agentsDir, { recursive: true });
  await writeFile(resolve(agentsDir, `${name}.md`), content, "utf8");
  await loadAgents();
  return getAgent(name);
};

export const setAgentModel = async (name, { provider, model }) => {
  validateName(name);
  if (!provider || typeof provider !== "string") throw new Error("Agent provider must be a non-empty string");
  if (!model || typeof model !== "string") throw new Error("Agent model must be a non-empty string");

  const definition = getAgent(name);
  if (!definition) throw new Error(`Unknown Agent: ${name}`);

  const updated = {
    ...definition,
    provider: provider.trim(),
    model: model.trim(),
  };
  await writeFile(definition.path, renderDefinition(updated), "utf8");
  await loadAgents();
  return getAgent(name);
};
