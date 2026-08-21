import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const skillsDir = resolve(here, "../../skills");
const skills = new Map();

const validateSkill = (name, content) => {
  if (!name || typeof name !== "string") throw new Error("Skill must have a valid name");
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`Skill ${name} must contain Markdown content`);
  }
};

export const loadSkills = async () => {
  await mkdir(skillsDir, { recursive: true });
  skills.clear();

  const files = await readdir(skillsDir);
  for (const filename of files.filter(file => file.endsWith(".md"))) {
    const path = resolve(skillsDir, filename);
    const content = await readFile(path, "utf8");
    const name = basename(filename, ".md");
    validateSkill(name, content);

    if (skills.has(name)) throw new Error(`Duplicate skill name: ${name}`);
    skills.set(name, { name, path, content });
  }

  return listSkills();
};

export const getSkill = name => {
  const skill = skills.get(name);
  return skill ? structuredClone(skill) : null;
};

export const listSkills = () => [...skills.values()].map(skill => structuredClone(skill));

export const saveSkill = async (name, content) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`Invalid skill name: ${name}`);
  validateSkill(name, content);

  await mkdir(skillsDir, { recursive: true });
  await writeFile(resolve(skillsDir, `${name}.md`), content, "utf8");
  await loadSkills();
  return getSkill(name);
};
