import {
  mkdir,
  readFile,
  writeFile,
  access
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const conversationsDir = resolve(
  here,
  "../../ObsidianVault/30-Conversations"
);
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
}

const pathsFor = (conversationId) => {
  validatePathPart(conversationId, "conversation ID");

  const conversationDir = resolve(conversationsDir, conversationId);

  return {
    conversationDir,
    filesDir: resolve(conversationDir, "files"),
    metadataFile: resolve(conversationDir, "artifacts.json")
  };
}

const persistArtifacts = async (conversationId) => {
  const { conversationDir, metadataFile } = pathsFor(conversationId);

  await mkdir(conversationDir, { recursive: true });

  const artifacts = artifactsByConversation.get(conversationId) ?? new Map();

  await writeFile(
    metadataFile,
    JSON.stringify(Object.fromEntries(artifacts), null, 2),
    "utf8"
  );
}

export const loadArtifacts = async (conversationId) => {
  const { conversationDir, filesDir, metadataFile } = pathsFor(conversationId);

  await mkdir(conversationDir, { recursive: true });
  await mkdir(filesDir, { recursive: true });

  const artifacts = new Map();

  try {
    const content = await readFile(metadataFile, "utf8");
    const stored = JSON.parse(content);

    for (const [id, metadata] of Object.entries(stored)) {
      artifacts.set(id, {
        id,
        ...metadata
      });
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  artifactsByConversation.set(conversationId, artifacts);

  return [...artifacts.values()];
}

const ensureLoaded = async (conversationId) => {
  if (!artifactsByConversation.has(conversationId)) {
    await loadArtifacts(conversationId);
  }

  return artifactsByConversation.get(conversationId);
}

export const createArtifact = async ({
  conversationId,
  name,
  type,
  createdBy,
  content
}) => {
  validatePathPart(name, "artifact filename");

  if (!type || typeof type !== "string") {
    throw new Error("Artifact type must be a non-empty string");
  }

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
  const filePath = resolve(filesDir, name);

  await writeFile(filePath, content);

  const artifact = {
    id,
    name,
    path: `files/${name}`,
    type,
    createdAt: new Date().toISOString(),
    createdBy
  };

  artifacts.set(id, artifact);
  await persistArtifacts(conversationId);

  return artifact;
}

export const registerArtifact = async ({
  conversationId,
  name,
  type,
  createdBy
}) => {
  validatePathPart(name, "artifact filename");

  if (!type || typeof type !== "string") {
    throw new Error("Artifact type must be a non-empty string");
  }

  if (!createdBy || typeof createdBy !== "string") {
    throw new Error("Artifact creator must be a non-empty string");
  }

  const artifacts = await ensureLoaded(conversationId);
  const { filesDir } = pathsFor(conversationId);
  const filePath = resolve(filesDir, name);

  await access(filePath);

  const id = `artifact-${randomUUID()}`;

  const artifact = {
    id,
    name,
    path: `files/${name}`,
    type,
    createdAt: new Date().toISOString(),
    createdBy
  };

  artifacts.set(id, artifact);
  await persistArtifacts(conversationId);

  return artifact;
}

export const getArtifact = async (conversationId, artifactId) => {
  const artifacts = await ensureLoaded(conversationId);
  return artifacts.get(artifactId) ?? null;
}

export const listArtifacts = async (conversationId) => {
  const artifacts = await ensureLoaded(conversationId);
  return [...artifacts.values()];
}

export const getArtifactPath = async (conversationId, artifactId) => {
  const artifact = await getArtifact(conversationId, artifactId);

  if (!artifact) {
    return null;
  }

  const { conversationDir } = pathsFor(conversationId);

  return resolve(conversationDir, artifact.path);
}

export const readArtifact = async (conversationId, artifactId) => {
  const path = await getArtifactPath(conversationId, artifactId);

  if (!path) {
    return null;
  }

  return readFile(path);
}