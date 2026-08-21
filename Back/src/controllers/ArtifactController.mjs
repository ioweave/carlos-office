import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const conversationsDir = resolve(here, "../../ObsidianVault/30-Conversations");
const artifactsByConversation = new Map();

const validatePathPart = (value, label) => {
  if (
    typeof value !== "string"
    || !value.trim()
    || basename(value) !== value
    || value === "."
    || value === ".."
  ) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
};

const pathsFor = conversationId => {
  validatePathPart(conversationId, "conversation ID");
  const conversationDir = resolve(conversationsDir, conversationId);

  return {
    conversationDir,
    filesDir: resolve(conversationDir, "files"),
    metadataFile: resolve(conversationDir, "artifacts.json"),
  };
};

const persistArtifacts = async conversationId => {
  const { conversationDir, metadataFile } = pathsFor(conversationId);
  await mkdir(conversationDir, { recursive: true });

  const artifacts = artifactsByConversation.get(conversationId) ?? new Map();
  await writeFile(metadataFile, JSON.stringify(Object.fromEntries(artifacts), null, 2), "utf8");
};

export const loadArtifacts = async conversationId => {
  const { conversationDir, filesDir, metadataFile } = pathsFor(conversationId);
  await mkdir(conversationDir, { recursive: true });
  await mkdir(filesDir, { recursive: true });

  const artifacts = new Map();

  try {
    const stored = JSON.parse(await readFile(metadataFile, "utf8"));
    for (const [id, metadata] of Object.entries(stored)) {
      artifacts.set(id, { id, ...metadata });
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  artifactsByConversation.set(conversationId, artifacts);
  return [...artifacts.values()].map(artifact => structuredClone(artifact));
};

const ensureLoaded = async conversationId => {
  if (!artifactsByConversation.has(conversationId)) await loadArtifacts(conversationId);
  return artifactsByConversation.get(conversationId);
};

const artifactStorageName = (id, name) => `${id}-${name}`;

export const createArtifact = async ({
  conversationId,
  name,
  type,
  createdBy,
  content,
}) => {
  validatePathPart(name, "artifact filename");
  if (!type || typeof type !== "string") throw new Error("Artifact type must be a non-empty string");
  if (!createdBy || typeof createdBy !== "string") {
    throw new Error("Artifact creator must be a non-empty string");
  }
  if (typeof content !== "string" && !Buffer.isBuffer(content)) {
    throw new Error("Artifact content must be a string or Buffer");
  }

  const artifacts = await ensureLoaded(conversationId);
  const { filesDir } = pathsFor(conversationId);
  await mkdir(filesDir, { recursive: true });

  const id = `artifact-${randomUUID()}`;
  const storageName = artifactStorageName(id, name);
  await writeFile(resolve(filesDir, storageName), content);

  const artifact = {
    id,
    name,
    path: `files/${storageName}`,
    type,
    createdAt: new Date().toISOString(),
    createdBy,
  };

  artifacts.set(id, artifact);
  await persistArtifacts(conversationId);
  return structuredClone(artifact);
};

export const registerArtifact = async ({
  conversationId,
  name,
  type,
  createdBy,
}) => {
  validatePathPart(name, "artifact filename");
  if (!type || typeof type !== "string") throw new Error("Artifact type must be a non-empty string");
  if (!createdBy || typeof createdBy !== "string") {
    throw new Error("Artifact creator must be a non-empty string");
  }

  const artifacts = await ensureLoaded(conversationId);
  const { filesDir } = pathsFor(conversationId);
  const sourcePath = resolve(filesDir, name);
  await access(sourcePath);

  const id = `artifact-${randomUUID()}`;
  const storageName = artifactStorageName(id, name);
  await rename(sourcePath, resolve(filesDir, storageName));

  const artifact = {
    id,
    name,
    path: `files/${storageName}`,
    type,
    createdAt: new Date().toISOString(),
    createdBy,
  };

  artifacts.set(id, artifact);
  await persistArtifacts(conversationId);
  return structuredClone(artifact);
};

export const getArtifact = async (conversationId, artifactId) => {
  const artifacts = await ensureLoaded(conversationId);
  const artifact = artifacts.get(artifactId);
  return artifact ? structuredClone(artifact) : null;
};

export const listArtifacts = async conversationId => {
  const artifacts = await ensureLoaded(conversationId);
  return [...artifacts.values()].map(artifact => structuredClone(artifact));
};

export const deleteArtifacts = async (conversationId, artifactIds) => {
  if (!Array.isArray(artifactIds)) throw new Error("Artifact IDs must be an array");
  const artifacts = await ensureLoaded(conversationId);
  const { conversationDir } = pathsFor(conversationId);
  const deleted = [];

  for (const artifactId of new Set(artifactIds)) {
    const artifact = artifacts.get(artifactId);
    if (!artifact) continue;
    await rm(resolve(conversationDir, artifact.path), { force: true });
    artifacts.delete(artifactId);
    deleted.push(artifactId);
  }

  if (deleted.length) await persistArtifacts(conversationId);
  return deleted;
};

export const getArtifactPath = async (conversationId, artifactId) => {
  const artifact = await getArtifact(conversationId, artifactId);
  if (!artifact) return null;

  const { conversationDir } = pathsFor(conversationId);
  return resolve(conversationDir, artifact.path);
};

export const readArtifact = async (conversationId, artifactId) => {
  const path = await getArtifactPath(conversationId, artifactId);
  return path ? readFile(path) : null;
};
