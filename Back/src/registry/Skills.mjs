import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const skillsDir = resolve(here, "../../skills");

const skills = new Map();

function validateSkill(name, content) {
  if (!name || typeof name !== "string") {
    throw new Error("Skill must have a valid name");
  }

  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`Skill ${name} must contain Markdown content`);
  }
}

export async function loadSkills() {
  await mkdir(skillsDir, { recursive: true });

  skills.clear();

  const files = await readdir(skillsDir);

  for (const filename of files.filter((file) => file.endsWith(".md"))) {
    const path = resolve(skillsDir, filename);
    const content = await readFile(path, "utf8");
    const name = basename(filename, ".md");

    validateSkill(name, content);

    if (skills.has(name)) {
      throw new Error(`Duplicate skill name: ${name}`);
    }

    skills.set(name, {
      name,
      path,
      content
    });
  }

  return skills;
}

export function getSkill(name) {
  return skills.get(name) ?? null;
}

export function listSkills() {
  return [...skills.values()];
}

export async function saveSkill(name, content) {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid skill name: ${name}`);
  }

  validateSkill(name, content);

  await mkdir(skillsDir, { recursive: true });

  const path = resolve(skillsDir, `${name}.md`);

  await writeFile(path, content, "utf8");
  await loadSkills();

  return getSkill(name);
}