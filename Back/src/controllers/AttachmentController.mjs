import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const conversationsDir = resolve(here, "../../ObsidianVault/Conversations");
const attachmentsByConversation = new Map();

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
    attachmentsDir: resolve(conversationDir, "attachments"),
    metadataFile: resolve(conversationDir, "attachments.json"),
  };
};

const persistAttachments = async conversationId => {
  const { conversationDir, metadataFile } = pathsFor(conversationId);
  await mkdir(conversationDir, { recursive: true });
  const attachments = attachmentsByConversation.get(conversationId) ?? new Map();
  await writeFile(metadataFile, JSON.stringify(Object.fromEntries(attachments), null, 2), "utf8");
};

export const loadAttachments = async conversationId => {
  const { conversationDir, attachmentsDir, metadataFile } = pathsFor(conversationId);
  await mkdir(conversationDir, { recursive: true });
  await mkdir(attachmentsDir, { recursive: true });

  const attachments = new Map();
  try {
    const stored = JSON.parse(await readFile(metadataFile, "utf8"));
    for (const [id, metadata] of Object.entries(stored)) attachments.set(id, { id, ...metadata });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  attachmentsByConversation.set(conversationId, attachments);
  return [...attachments.values()].map(attachment => structuredClone(attachment));
};

const ensureLoaded = async conversationId => {
  if (!attachmentsByConversation.has(conversationId)) await loadAttachments(conversationId);
  return attachmentsByConversation.get(conversationId);
};

const storageName = (id, name) => `${id}-${name}`;

export const createAttachment = async ({
  conversationId,
  name,
  type,
  createdBy,
  content,
  createdAt = null,
}) => {
  validatePathPart(name, "attachment filename");
  if (!type || typeof type !== "string") throw new Error("Attachment type must be a non-empty string");
  if (!createdBy || typeof createdBy !== "string") throw new Error("Attachment creator must be a non-empty string");
  if (typeof content !== "string" && !Buffer.isBuffer(content)) {
    throw new Error("Attachment content must be a string or Buffer");
  }

  const attachments = await ensureLoaded(conversationId);
  const { attachmentsDir } = pathsFor(conversationId);
  await mkdir(attachmentsDir, { recursive: true });

  const id = `attachment-${randomUUID()}`;
  const storedName = storageName(id, name);
  await writeFile(resolve(attachmentsDir, storedName), content);

  const attachment = {
    id,
    name,
    path: `attachments/${storedName}`,
    type,
    createdAt: createdAt || new Date().toISOString(),
    createdBy,
  };

  attachments.set(id, attachment);
  await persistAttachments(conversationId);
  return structuredClone(attachment);
};

export const getAttachment = async (conversationId, attachmentId) => {
  const attachments = await ensureLoaded(conversationId);
  const attachment = attachments.get(attachmentId);
  return attachment ? structuredClone(attachment) : null;
};

export const listAttachments = async conversationId => {
  const attachments = await ensureLoaded(conversationId);
  return [...attachments.values()].map(attachment => structuredClone(attachment));
};

export const deleteAttachments = async (conversationId, attachmentIds) => {
  if (!Array.isArray(attachmentIds)) throw new Error("Attachment IDs must be an array");
  const attachments = await ensureLoaded(conversationId);
  const { conversationDir } = pathsFor(conversationId);
  const deleted = [];

  for (const attachmentId of new Set(attachmentIds)) {
    const attachment = attachments.get(attachmentId);
    if (!attachment) continue;
    await rm(resolve(conversationDir, attachment.path), { force: true });
    attachments.delete(attachmentId);
    deleted.push(attachmentId);
  }

  if (deleted.length) await persistAttachments(conversationId);
  return deleted;
};

export const getAttachmentPath = async (conversationId, attachmentId) => {
  const attachment = await getAttachment(conversationId, attachmentId);
  if (!attachment) return null;
  const { conversationDir } = pathsFor(conversationId);
  return resolve(conversationDir, attachment.path);
};

export const readAttachment = async (conversationId, attachmentId) => {
  const path = await getAttachmentPath(conversationId, attachmentId);
  return path ? readFile(path) : null;
};
