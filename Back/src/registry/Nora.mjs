import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const noraPath = resolve(here, "../../ObsidianVault/System/Nora.md");
let definition = null;

const parseDefinition = content => {
  if (typeof content !== "string" || !content.trim()) throw new Error("Nora definition must not be empty");

  return {
    name: "Nora",
    provider: content.match(/^provider:\s*(.+)$/im)?.[1]?.trim() || null,
    model: content.match(/^model:\s*(.+)$/im)?.[1]?.trim() || null,
    instructions: content
      .split(/\r?\n/)
      .filter(line => !/^\s*(provider|model):\s*/i.test(line))
      .join("\n")
      .trim(),
  };
};

const renderDefinition = value => [
  `provider: ${value.provider}`,
  `model: ${value.model}`,
  "",
  value.instructions,
  "",
].join("\n");

export const loadNoraDefinition = async () => {
  definition = parseDefinition(await readFile(noraPath, "utf8"));
  return getNora();
};

export const saveNoraDefinition = async ({ provider, model }) => {
  if (typeof provider !== "string" || !provider.trim()) throw new Error("Nora provider is required");
  if (typeof model !== "string" || !model.trim()) throw new Error("Nora model is required");
  if (!definition) await loadNoraDefinition();

  const next = {
    ...definition,
    provider: provider.trim(),
    model: model.trim(),
  };
  await writeFile(noraPath, renderDefinition(next), "utf8");
  definition = next;
  return getNora();
};

export const getNora = () => definition ? structuredClone(definition) : null;
