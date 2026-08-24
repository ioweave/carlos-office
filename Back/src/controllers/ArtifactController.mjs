import { access, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const conversationsDir = resolve(here, "../../ObsidianVault/Conversations");
const artifactsByConversation = new Map();

const MIME_BY_EXTENSION = new Map(Object.entries({
  ".aac": "audio/aac",
  ".avi": "video/x-msvideo",
  ".bmp": "image/bmp",
  ".c": "text/plain",
  ".cpp": "text/plain",
  ".css": "text/css",
  ".csv": "text/csv",
  ".gif": "image/gif",
  ".go": "text/plain",
  ".h": "text/plain",
  ".htm": "text/html",
  ".html": "text/html",
  ".ini": "text/plain",
  ".java": "text/plain",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript",
  ".json": "application/json",
  ".jsx": "text/javascript",
  ".m4a": "audio/mp4",
  ".md": "text/markdown",
  ".mjs": "text/javascript",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".py": "text/x-python",
  ".rb": "text/plain",
  ".rs": "text/plain",
  ".scss": "text/x-scss",
  ".sh": "text/x-shellscript",
  ".sql": "application/sql",
  ".svg": "image/svg+xml",
  ".toml": "text/plain",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".txt": "text/plain",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".xml": "application/xml",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
}));

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
    artifactsDir: resolve(conversationDir, "artifacts"),
    legacyFilesDir: resolve(conversationDir, "files"),
    metadataFile: resolve(conversationDir, "artifacts.json"),
  };
};

const persistArtifacts = async conversationId => {
  const { conversationDir, metadataFile } = pathsFor(conversationId);
  await mkdir(conversationDir, { recursive: true });

  const artifacts = artifactsByConversation.get(conversationId) ?? new Map();
  await writeFile(metadataFile, JSON.stringify(Object.fromEntries(artifacts), null, 2), "utf8");
};

export const inferArtifactType = name => MIME_BY_EXTENSION.get(extname(String(name || "")).toLowerCase())
  || "application/octet-stream";

export const loadArtifacts = async conversationId => {
  const { conversationDir, artifactsDir, metadataFile } = pathsFor(conversationId);
  await mkdir(conversationDir, { recursive: true });
  await mkdir(artifactsDir, { recursive: true });

  const artifacts = new Map();
  let migrated = false;

  try {
    const stored = JSON.parse(await readFile(metadataFile, "utf8"));
    for (const [id, rawMetadata] of Object.entries(stored)) {
      const metadata = { ...rawMetadata };
      if (typeof metadata.path === "string" && metadata.path.startsWith("files/")) {
        const storedName = basename(metadata.path);
        const legacyPath = resolve(conversationDir, metadata.path);
        const nextPath = resolve(artifactsDir, storedName);
        try {
          await rename(legacyPath, nextPath);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          await access(nextPath);
        }
        metadata.path = `artifacts/${storedName}`;
        migrated = true;
      }
      artifacts.set(id, { id, ...metadata });
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  artifactsByConversation.set(conversationId, artifacts);
  if (migrated) await persistArtifacts(conversationId);
  return [...artifacts.values()].map(artifact => structuredClone(artifact));
};

const ensureLoaded = async conversationId => {
  if (!artifactsByConversation.has(conversationId)) await loadArtifacts(conversationId);
  return artifactsByConversation.get(conversationId);
};

const artifactStorageName = (id, name) => `${id}-${name}`;

const validateArtifactMetadata = ({ name, type, createdBy }) => {
  validatePathPart(name, "artifact filename");
  if (!type || typeof type !== "string") throw new Error("Artifact type must be a non-empty string");
  if (!createdBy || typeof createdBy !== "string") {
    throw new Error("Artifact creator must be a non-empty string");
  }
};

export const createArtifact = async ({
  conversationId,
  name,
  type,
  createdBy,
  content,
}) => {
  validateArtifactMetadata({ name, type, createdBy });
  if (typeof content !== "string" && !Buffer.isBuffer(content)) {
    throw new Error("Artifact content must be a string or Buffer");
  }

  const artifacts = await ensureLoaded(conversationId);
  const { artifactsDir } = pathsFor(conversationId);
  await mkdir(artifactsDir, { recursive: true });

  const id = `artifact-${randomUUID()}`;
  const storageName = artifactStorageName(id, name);
  await writeFile(resolve(artifactsDir, storageName), content);

  const artifact = {
    id,
    name,
    path: `artifacts/${storageName}`,
    type,
    createdAt: new Date().toISOString(),
    createdBy,
  };

  artifacts.set(id, artifact);
  await persistArtifacts(conversationId);
  return structuredClone(artifact);
};

export const importArtifact = async ({
  conversationId,
  sourcePath,
  name = null,
  type = null,
  createdBy,
}) => {
  if (!sourcePath || typeof sourcePath !== "string") throw new Error("Artifact source path must be a non-empty string");
  const absoluteSource = resolve(sourcePath);
  const sourceInfo = await stat(absoluteSource);
  if (!sourceInfo.isFile()) throw new Error(`Artifact source is not a file: ${sourcePath}`);

  const artifactName = name?.trim() || basename(absoluteSource);
  const artifactType = type?.trim() || inferArtifactType(artifactName);
  validateArtifactMetadata({ name: artifactName, type: artifactType, createdBy });

  const artifacts = await ensureLoaded(conversationId);
  const { artifactsDir } = pathsFor(conversationId);
  await mkdir(artifactsDir, { recursive: true });

  const id = `artifact-${randomUUID()}`;
  const storageName = artifactStorageName(id, artifactName);
  await copyFile(absoluteSource, resolve(artifactsDir, storageName));

  const artifact = {
    id,
    name: artifactName,
    path: `artifacts/${storageName}`,
    type: artifactType,
    createdAt: new Date().toISOString(),
    createdBy,
    sourcePath: absoluteSource,
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
  validateArtifactMetadata({ name, type, createdBy });

  const artifacts = await ensureLoaded(conversationId);
  const { artifactsDir } = pathsFor(conversationId);
  const sourcePath = resolve(artifactsDir, name);
  await access(sourcePath);

  const id = `artifact-${randomUUID()}`;
  const storageName = artifactStorageName(id, name);
  await rename(sourcePath, resolve(artifactsDir, storageName));

  const artifact = {
    id,
    name,
    path: `artifacts/${storageName}`,
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
