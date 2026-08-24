import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const knowledgeDir = resolve(here, "../../ObsidianVault/Knowledge");
const factsPath = resolve(knowledgeDir, "Facts.md");
const instructionsPath = resolve(knowledgeDir, "Instructions.md");
let knowledge = { facts: "", instructions: "" };

const readDocument = async path => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(path, "", "utf8");
    return "";
  }
};

export const loadKnowledge = async () => {
  await mkdir(knowledgeDir, { recursive: true });
  const [facts, instructions] = await Promise.all([
    readDocument(factsPath),
    readDocument(instructionsPath),
  ]);
  knowledge = { facts: facts.trim(), instructions: instructions.trim() };
  return getKnowledge();
};

export const getKnowledge = () => structuredClone(knowledge);

export const saveKnowledge = async ({ facts, instructions }) => {
  if (typeof facts !== "string") throw new Error("Knowledge facts must be a string");
  if (typeof instructions !== "string") throw new Error("Knowledge instructions must be a string");

  const next = { facts: facts.trim(), instructions: instructions.trim() };
  await mkdir(knowledgeDir, { recursive: true });
  await Promise.all([
    writeFile(factsPath, next.facts ? `${next.facts}\n` : "", "utf8"),
    writeFile(instructionsPath, next.instructions ? `${next.instructions}\n` : "", "utf8"),
  ]);
  knowledge = next;
  return getKnowledge();
};
