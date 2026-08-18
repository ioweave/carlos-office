import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const agentsDir = resolve(here, "../../ObsidianVault/90-System/Agents");
const blueprints = new Map();
const activeAgents = new Map();
let nextAgentId = 1;

const validateName = (name) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid agent name: ${name}`);
  }
}

const parseBlueprint = (name, path, content) => {
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`Agent ${name} must contain configuration or instructions`);
  }

  const provider = content.match(/^provider:\s*(.+)$/im)?.[1]?.trim() || null;
  const model = content.match(/^model:\s*(.+)$/im)?.[1]?.trim() || null;
  const instructions = content
    .split(/\r?\n/)
    .filter((line) => !/^\s*(provider|model):\s*/i.test(line))
    .join("\n")
    .trim();

  return {
    name,
    path,
    provider,
    model,
    instructions,
    isNora: name.toLowerCase() === "nora",
  };
}

const renderBlueprint = (blueprint) => {
  const lines = [];

  if (blueprint.provider) {
    lines.push(`provider: ${blueprint.provider}`);
  }

  if (blueprint.model) {
    lines.push(`model: ${blueprint.model}`);
  }

  if (blueprint.instructions) {
    lines.push("", blueprint.instructions.trim());
  }

  return `${lines.join("\n").trim()}\n`;
}

export const loadBlueprints = async () => {
  await mkdir(agentsDir, { recursive: true });

  blueprints.clear();

  const files = await readdir(agentsDir);

  for (const filename of files.filter((file) => file.endsWith(".md"))) {
    const path = resolve(agentsDir, filename);
    const name = basename(filename, ".md");
    const content = await readFile(path, "utf8");

    blueprints.set(name, parseBlueprint(name, path, content));
  }

  return listBlueprints();
}

export const getBlueprint = (name) => {
  return blueprints.get(name) ?? null;
}

export const listBlueprints = () => {
  return [...blueprints.values()];
}

export const getNoraBlueprint = () => {
  return [...blueprints.values()].find((blueprint) => blueprint.isNora) ?? null;
}

export const saveBlueprint = async (name, content) => {
  validateName(name);

  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`Agent ${name} must contain configuration or instructions`);
  }

  await mkdir(agentsDir, { recursive: true });

  await writeFile(resolve(agentsDir, `${name}.md`), content, "utf8");

  await loadBlueprints();

  return getBlueprint(name);
}

export const setBlueprintModel = async (name, { provider, model }) => {
  validateName(name);

  if (!provider || typeof provider !== "string") {
    throw new Error("Agent provider must be a non-empty string");
  }

  if (!model || typeof model !== "string") {
    throw new Error("Agent model must be a non-empty string");
  }

  const blueprint = getBlueprint(name);

  if (!blueprint) {
    throw new Error(`Unknown agent blueprint: ${name}`);
  }

  const updated = {
    ...blueprint,
    provider: provider.trim(),
    model: model.trim(),
  };

  await writeFile(blueprint.path, renderBlueprint(updated), "utf8");

  await loadBlueprints();

  return getBlueprint(name);
}

export const createAgent = (blueprintName, taskId = null, context = {}) => {
  const blueprint = getBlueprint(blueprintName);

  if (!blueprint) {
    throw new Error(`Unknown agent blueprint: ${blueprintName}`);
  }

  if (blueprint.isNora) {
    throw new Error("Nora cannot be created as a disposable Agent Instance");
  }

  const id = `agent-${nextAgentId++}`;

  const agent = {
    id,
    name: `${blueprint.name}-${id}`,
    blueprint: blueprint.name,
    status: taskId ? "working" : "idle",
    taskId,
    context,
    notes: [],
  };

  activeAgents.set(id, agent);

  return agent;
}

export const getAgent = (id) => {
  return activeAgents.get(id) ?? null;
}

export const listActiveAgents = () => {
  return [...activeAgents.values()];
}

export const assignTask = (id, taskId) => {
  const agent = getAgent(id);

  if (!agent) {
    throw new Error(`Unknown agent: ${id}`);
  }

  agent.taskId = taskId;
  agent.status = "working";

  return agent;
}

export const setAgentStatus = (id, status) => {
  const agent = getAgent(id);

  if (!agent) {
    throw new Error(`Unknown agent: ${id}`);
  }

  agent.status = status;

  return agent;
}

export const setAgentContext = (id, context) => {
  const agent = getAgent(id);

  if (!agent) {
    throw new Error(`Unknown agent: ${id}`);
  }

  agent.context = context;

  return agent;
}

export const addAgentNote = (id, note) => {
  const agent = getAgent(id);

  if (!agent) {
    throw new Error(`Unknown agent: ${id}`);
  }

  agent.notes.push(note);

  return agent;
}

export const disposeAgent = (id) => {
  return activeAgents.delete(id);
}
