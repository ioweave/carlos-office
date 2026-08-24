import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const vaultDir = resolve(here, "../../ObsidianVault");

const DIRECTORY_MIGRATIONS = [
  ["30-Conversations", "Conversations"],
  ["90-System", "System"],
];
const OBSOLETE_DIRECTORIES = [
  "00-Inbox",
  "15-Memory",
  "20-Agents",
  "40-Jobs",
  "45-Tasks",
  "50-Artifacts",
  "60-Workspace",
  "System/Agents",
  "System/Runtime/Agents",
];

const moveDirectoryContents = async (sourceDir, targetDir) => {
  let entries;
  try {
    entries = await readdir(sourceDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  await mkdir(targetDir, { recursive: true });
  for (const entry of entries) {
    const sourcePath = resolve(sourceDir, entry.name);
    const targetPath = resolve(targetDir, entry.name);

    if (entry.isDirectory()) {
      await moveDirectoryContents(sourcePath, targetPath);
      continue;
    }

    try {
      await rename(sourcePath, targetPath);
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes(error.code)) throw error;
      await rm(targetPath, { force: true });
      await rename(sourcePath, targetPath);
    }
  }

  await rm(sourceDir, { recursive: true, force: true });
};

export const prepareVaultStructure = async () => {
  for (const [legacyPath, currentPath] of DIRECTORY_MIGRATIONS) {
    await moveDirectoryContents(resolve(vaultDir, legacyPath), resolve(vaultDir, currentPath));
  }

  await Promise.all(OBSOLETE_DIRECTORIES.map(path => (
    rm(resolve(vaultDir, path), { recursive: true, force: true })
  )));
};
