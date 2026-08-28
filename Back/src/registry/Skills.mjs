import { watch } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { notifyOfficeStateChanged } from "../services/OfficeStateBus.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const skillsDir = resolve(here, "../../skills");
const skills = new Map();
let skillsWatcher = null;
let reloadTimer = null;
let reloadPromise = null;
let registryRevision = 0;
let registrySignature = "";

const validateSkill = (name, content) => {
  if (!name || typeof name !== "string") throw new Error("Skill must have a valid name");
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`Skill ${name} must contain Markdown content`);
  }
};

const loadSkillFile = async (name, path) => {
  const content = await readFile(path, "utf8");
  validateSkill(name, content);
  return { name, path, content };
};

const reloadFromDisk = async () => {
  await mkdir(skillsDir, { recursive: true });
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const discovered = new Map();

  for (const entry of entries.filter(item => item.isFile() && item.name.endsWith(".md"))) {
    const name = basename(entry.name, ".md");
    discovered.set(name, await loadSkillFile(name, resolve(skillsDir, entry.name)));
  }

  const nextSignature = JSON.stringify(
    [...discovered.entries()].map(([name, skill]) => [name, skill.path, skill.content]),
  );
  const changed = nextSignature !== registrySignature;
  if (changed) {
    registrySignature = nextSignature;
    registryRevision += 1;
  }

  skills.clear();
  for (const [name, skill] of discovered) skills.set(name, skill);
  if (changed) notifyOfficeStateChanged("skillsRevision");
  return listSkills();
};

const scheduleReload = () => {
  if (reloadTimer !== null) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    void loadSkills().catch(error => {
      console.error("[skills] Could not refresh Skill registry after filesystem change.", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }, 150);
};

const ensureWatcher = () => {
  if (skillsWatcher) return;

  try {
    skillsWatcher = watch(skillsDir, scheduleReload);
    skillsWatcher.on("error", error => {
      console.error("[skills] Skill registry watcher failed.", {
        message: error instanceof Error ? error.message : String(error),
      });
      skillsWatcher?.close();
      skillsWatcher = null;
    });
  } catch (error) {
    console.error("[skills] Could not watch Skill registry.", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

export const loadSkills = async () => {
  if (!reloadPromise) {
    reloadPromise = reloadFromDisk().finally(() => {
      reloadPromise = null;
    });
  }

  const result = await reloadPromise;
  ensureWatcher();
  return result;
};

export const getSkill = name => {
  const skill = skills.get(name);
  return skill ? structuredClone(skill) : null;
};

export const listSkills = () => [...skills.values()].map(skill => structuredClone(skill));
export const getSkillsRevision = () => registryRevision;

export const saveSkill = async (name, content) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`Invalid skill name: ${name}`);
  validateSkill(name, content);

  await mkdir(skillsDir, { recursive: true });
  await writeFile(resolve(skillsDir, `${name}.md`), content, "utf8");
  await loadSkills();
  return getSkill(name);
};
