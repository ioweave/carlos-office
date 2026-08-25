import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const targets = [resolve(root, "platform.mjs"), resolve(root, "src"), resolve(root, "tools")];

const collect = async path => {
  if (path.endsWith(".mjs")) return [path];
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) return collect(child);
    return entry.isFile() && entry.name.endsWith(".mjs") ? [child] : [];
  }));
  return nested.flat();
};

const files = (await Promise.all(targets.map(collect))).flat().sort();
let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) failed = true;
}

if (failed) process.exit(1);
console.log(`Syntax OK: ${files.length} backend modules.`);
