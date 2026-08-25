import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { createAttachment, deleteAttachments, getAttachment, listAttachments, readAttachment } from "./AttachmentController.mjs";
import {
  createArtifact,
  deleteArtifacts,
  getArtifact,
  listArtifacts,
  readArtifact,
} from "./ArtifactController.mjs";
import { atomicWriteFile } from "../lib/AtomicFile.mjs";
import { notifyOfficeStateChanged } from "../services/OfficeStateBus.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const conversationsDir = resolve(here, "../../ObsidianVault/Conversations");
const conversations = new Map();
const MAX_JSON_BODY_BYTES = 64_000_000;

const validateConversationId = id => {
  if (
    typeof id !== "string"
    || !id.trim()
    || basename(id) !== id
    || id === "."
    || id === ".."
  ) {
    throw new Error(`Invalid conversation ID: ${id}`);
  }
};

const normalizeMessageId = id => {
  if (id == null) return `message-${randomUUID()}`;
  if (
    typeof id !== "string"
    || !id.trim()
    || basename(id) !== id
    || id === "."
    || id === ".."
    || id.length > 180
  ) {
    throw new Error(`Invalid message ID: ${id}`);
  }
  return id.trim();
};

const validateModelSelection = selection => {
  if (
    !selection
    || typeof selection !== "object"
    || Array.isArray(selection)
    || !selection.provider
    || typeof selection.provider !== "string"
    || !selection.model
    || typeof selection.model !== "string"
  ) {
    throw new Error("Conversation must have a Nora provider and model");
  }
};

const normalizeTitle = title => {
  if (title === null) return null;
  if (typeof title !== "string") throw new Error("Conversation title must be a string");

  const value = title.trim();
  if (!value) throw new Error("Conversation title cannot be empty");
  if (value.length > 120) throw new Error("Conversation title cannot exceed 120 characters");
  return value;
};

const normalizeUtc = (value, label) => {
  const date = new Date(value);
  if (typeof value !== "string" || Number.isNaN(date.getTime())) throw new Error(`Invalid ${label}: ${value}`);
  return date.toISOString();
};

const conversationPath = id => {
  validateConversationId(id);
  return resolve(conversationsDir, id, "thread.md");
};

const renderConversation = conversation => {
  const metadata = JSON.stringify({
    id: conversation.id,
    title: conversation.title ?? null,
    nora: conversation.nora,
    workflows: conversation.workflows,
  });
  const messages = conversation.messages
    .map(message => {
      const messageMetadata = JSON.stringify({
        id: message.id,
        actor: message.actor,
        at: message.at,
        attachments: message.attachments ?? [],
        artifacts: message.artifacts ?? [],
        ...(message.workflowId ? { workflowId: message.workflowId } : {}),
      });

      return [
        `<!-- carlos-office:message ${messageMetadata} -->`,
        "",
        message.content,
        "",
        "<!-- /carlos-office:message -->",
      ].join("\n");
    })
    .join("\n\n");

  return [
    "# Conversation",
    "",
    `<!-- carlos-office:conversation ${metadata} -->`,
    "",
    messages,
    "",
  ].join("\n");
};

const parseConversation = (content, fallbackId) => {
  const match = content.match(/<!-- carlos-office:conversation (.+?) -->/);
  const metadata = match ? JSON.parse(match[1]) : { id: fallbackId, workflows: [] };
  const id = metadata.id ?? fallbackId;
  const messages = [];
  const pattern = /<!-- carlos-office:message (.+?) -->\s*\n([\s\S]*?)\n\s*<!-- \/carlos-office:message -->/g;

  for (const entry of content.matchAll(pattern)) {
    const message = JSON.parse(entry[1]);
    messages.push({
      id: message.id,
      actor: message.actor,
      at: normalizeUtc(message.at, `message ${message.id} timestamp`),
      content: entry[2].trim(),
      attachments: Array.isArray(message.attachments) ? message.attachments : [],
      artifacts: Array.isArray(message.artifacts) ? message.artifacts : [],
      workflowId: typeof message.workflowId === "string" && message.workflowId.trim()
        ? message.workflowId.trim()
        : null,
    });
  }

  return {
    id,
    path: conversationPath(id),
    title: typeof metadata.title === "string" && metadata.title.trim() ? metadata.title.trim() : null,
    nora: metadata.nora ?? null,
    messages,
    workflows: Array.isArray(metadata.workflows) ? metadata.workflows : [],
  };
};

const persistConversation = async conversation => {
  const path = conversationPath(conversation.id);
  await atomicWriteFile(path, renderConversation(conversation), "utf8");
};

const commitConversation = async conversation => {
  await persistConversation(conversation);
  conversations.set(conversation.id, conversation);
  notifyOfficeStateChanged("conversations");
  return structuredClone(conversation);
};

const ensureLoaded = async id => conversations.get(id) ?? loadConversation(id);

export const createConversation = async ({ id = null, nora } = {}) => {
  validateModelSelection(nora);
  const conversationId = id ?? `conversation-${randomUUID()}`;
  validateConversationId(conversationId);

  if (conversations.has(conversationId)) throw new Error(`Conversation already exists: ${conversationId}`);

  const conversation = {
    id: conversationId,
    path: conversationPath(conversationId),
    title: null,
    nora: {
      provider: nora.provider.trim(),
      model: nora.model.trim(),
    },
    messages: [],
    workflows: [],
  };

  return commitConversation(conversation);
};

export const loadConversation = async id => {
  validateConversationId(id);
  const conversation = parseConversation(await readFile(conversationPath(id), "utf8"), id);
  conversations.set(id, conversation);
  return structuredClone(conversation);
};

export const loadConversations = async () => {
  await mkdir(conversationsDir, { recursive: true });
  conversations.clear();

  const entries = await readdir(conversationsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    try {
      await loadConversation(entry.name);
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.error("[conversations] Could not load Conversation.", {
          conversationId: entry.name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return listConversations();
};

export const migrateLegacyCarlosAttachments = async () => {
  let migrated = 0;

  for (const current of [...conversations.values()]) {
    const conversation = structuredClone(current);
    const legacyArtifactIds = [];
    let changed = false;

    for (const message of conversation.messages) {
      if (message.actor !== "Carlos" || !message.artifacts?.length) continue;

      const attachmentIds = [...(message.attachments ?? [])];
      for (const artifactId of message.artifacts) {
        const artifact = await getArtifact(conversation.id, artifactId);
        if (!artifact) continue;
        const content = await readArtifact(conversation.id, artifactId);
        if (!content) continue;

        const attachment = await createAttachment({
          conversationId: conversation.id,
          name: artifact.name,
          type: artifact.type,
          createdBy: artifact.createdBy || "Carlos",
          content,
          createdAt: artifact.createdAt,
        });
        attachmentIds.push(attachment.id);
        legacyArtifactIds.push(artifactId);
        migrated += 1;
      }

      message.attachments = [...new Set(attachmentIds)];
      message.artifacts = message.artifacts.filter(id => !legacyArtifactIds.includes(id));
      changed = true;
    }

    if (changed) await commitConversation(conversation);
    if (legacyArtifactIds.length) await deleteArtifacts(conversation.id, legacyArtifactIds);
  }

  return migrated;
};

export const getConversation = async id => {
  try {
    const conversation = await ensureLoaded(id);
    return conversation ? structuredClone(conversation) : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

export const listConversations = () => (
  [...conversations.values()].map(conversation => structuredClone(conversation))
);

export const setConversationTitle = async (conversationId, title) => {
  const current = await ensureLoaded(conversationId);
  const conversation = structuredClone(current);
  conversation.title = normalizeTitle(title);
  return commitConversation(conversation);
};

export const deleteConversation = async conversationId => {
  validateConversationId(conversationId);
  const current = await getConversation(conversationId);
  if (!current) return false;

  await rm(dirname(conversationPath(conversationId)), { recursive: true, force: true });
  conversations.delete(conversationId);
  notifyOfficeStateChanged(["conversations", "attachments", "artifacts"]);
  return true;
};

export const setConversationNoraModel = async (conversationId, selection) => {
  validateModelSelection(selection);
  const current = await ensureLoaded(conversationId);
  const conversation = structuredClone(current);
  conversation.nora = {
    provider: selection.provider.trim(),
    model: selection.model.trim(),
  };

  return commitConversation(conversation);
};

export const editCarlosMessage = async (conversationId, messageId, content, removedWorkflowIds = []) => {
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Edited message content must be a non-empty string");
  }
  if (!Array.isArray(removedWorkflowIds)) throw new Error("Removed Workflow IDs must be an array");

  const current = await ensureLoaded(conversationId);
  const conversation = structuredClone(current);
  const index = conversation.messages.findIndex(message => message.id === messageId);
  if (index === -1) throw new Error(`Unknown message: ${messageId}`);
  if (conversation.messages[index].actor !== "Carlos") throw new Error("Only Carlos messages can be edited");

  const removedMessages = conversation.messages.slice(index + 1);
  const removedAttachmentIds = removedMessages.flatMap(message => message.attachments ?? []);
  const removedArtifactIds = removedMessages.flatMap(message => message.artifacts ?? []);

  conversation.messages[index].content = content.trim();
  conversation.messages = conversation.messages.slice(0, index + 1);

  const removed = new Set(removedWorkflowIds);
  conversation.workflows = conversation.workflows.filter(workflowId => !removed.has(workflowId));
  const committed = await commitConversation(conversation);
  if (removedAttachmentIds.length) await deleteAttachments(conversationId, removedAttachmentIds);
  if (removedArtifactIds.length) await deleteArtifacts(conversationId, removedArtifactIds);
  return committed;
};

export const addMessage = async (
  conversationId,
  { id = null, actor, content, attachments = [], artifacts = [], workflowId = null },
) => {
  if (!actor || typeof actor !== "string") throw new Error("Message actor must be a non-empty string");
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Message content must be a non-empty string");
  }
  if (!Array.isArray(attachments)) throw new Error("Message attachments must be an array");
  if (!Array.isArray(artifacts)) throw new Error("Message artifacts must be an array");
  if (workflowId != null && (typeof workflowId !== "string" || !workflowId.trim())) {
    throw new Error("Message Workflow ID must be a non-empty string when present");
  }

  for (const attachmentId of attachments) {
    if (!(await getAttachment(conversationId, attachmentId))) throw new Error(`Unknown attachment: ${attachmentId}`);
  }
  for (const artifactId of artifacts) {
    if (!(await getArtifact(conversationId, artifactId))) throw new Error(`Unknown artifact: ${artifactId}`);
  }

  const current = await ensureLoaded(conversationId);
  const messageId = normalizeMessageId(id);
  const existing = current.messages.find(message => message.id === messageId);
  if (existing) {
    const exactRetry = (
      existing.actor === actor
      && existing.content === content.trim()
      && JSON.stringify(existing.attachments ?? []) === JSON.stringify(attachments)
      && JSON.stringify(existing.artifacts ?? []) === JSON.stringify(artifacts)
      && (existing.workflowId ?? null) === (workflowId?.trim() || null)
    );
    if (exactRetry) return structuredClone(existing);
    throw new Error(`Message ID already exists: ${messageId}`);
  }

  const conversation = structuredClone(current);
  const message = {
    id: messageId,
    actor,
    at: new Date().toISOString(),
    content: content.trim(),
    attachments: [...attachments],
    artifacts: [...artifacts],
    workflowId: workflowId?.trim() || null,
  };

  conversation.messages.push(message);
  await commitConversation(conversation);
  return structuredClone(message);
};

export const addArtifactToMessage = async (conversationId, messageId, artifactId) => {
  if (!(await getArtifact(conversationId, artifactId))) throw new Error(`Unknown artifact: ${artifactId}`);

  const current = await ensureLoaded(conversationId);
  const conversation = structuredClone(current);
  const message = conversation.messages.find(item => item.id === messageId);
  if (!message) throw new Error(`Unknown message: ${messageId}`);

  message.artifacts ??= [];
  if (!message.artifacts.includes(artifactId)) message.artifacts.push(artifactId);
  await commitConversation(conversation);
  return structuredClone(message);
};

export const addWorkflow = async (conversationId, workflowId) => {
  if (!workflowId || typeof workflowId !== "string") {
    throw new Error("Workflow ID must be a non-empty string");
  }

  const current = await ensureLoaded(conversationId);
  if (current.workflows.includes(workflowId)) return structuredClone(current);

  const conversation = structuredClone(current);
  conversation.workflows.push(workflowId);
  return commitConversation(conversation);
};

export const removeWorkflowReference = async workflowId => {
  if (!workflowId || typeof workflowId !== "string") {
    throw new Error("Workflow ID must be a non-empty string");
  }

  const updated = [];
  for (const current of conversations.values()) {
    if (!current.workflows.includes(workflowId)) continue;
    const conversation = structuredClone(current);
    conversation.workflows = conversation.workflows.filter(id => id !== workflowId);
    await commitConversation(conversation);
    updated.push(conversation.id);
  }

  return updated;
};

const requestError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const partsFrom = pathname => pathname.split("/").filter(Boolean).map(decodeURIComponent);
const safeFilename = value => String(value || "file").replaceAll('"', "");

/** HTTP transport for conversation requests and binary resources. */
export const createConversationResourceController = ({ allowedOrigin, nora }) => {
  if (!allowedOrigin || typeof allowedOrigin !== "string") {
    throw new Error("Conversation resource controller requires one allowed frontend origin");
  }

  const readJson = async req => {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_JSON_BODY_BYTES) throw requestError(`Request body exceeds ${MAX_JSON_BODY_BYTES} bytes`, 413);
      chunks.push(chunk);
    }
    if (!chunks.length) return {};
    try {
      return JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
    } catch {
      throw requestError("Invalid JSON request body");
    }
  };

  const matches = req => {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const parts = partsFrom(url.pathname);
    if (parts[0] !== "conversations" || !parts[1]) return false;
    if (parts[2] === "requests" && [3, 4].includes(parts.length)) return true;
    if (["attachments", "artifacts"].includes(parts[2]) && [3, 4].includes(parts.length)) return true;
    return false;
  };

  const handle = async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const parts = partsFrom(url.pathname);
    const method = req.method ?? "GET";
    const origin = req.headers.origin ?? null;

    if (origin && origin !== allowedOrigin) {
      res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Origin not allowed" }));
      return;
    }

    const cors = {
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
      ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    };
    const sendJson = (status, data) => {
      res.writeHead(status, { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(data));
    };
    const sendError = (status, message) => sendJson(status, { error: message });

    if (method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    try {
      const conversationId = parts[1];
      const resource = parts[2];
      const resourceId = parts[3] ?? null;

      if (method === "POST" && resource === "requests" && parts.length === 3) {
        const body = await readJson(req);
        let messageId = body.messageId == null ? null : normalizeMessageId(body.messageId);
        const current = await getConversation(conversationId);
        if (!current) throw requestError("Conversation not found", 404);

        if (messageId) {
          const existingIndex = current.messages.findIndex(message => message.id === messageId);
          if (existingIndex >= 0) {
            const existing = current.messages[existingIndex];
            const sameRequest = (
              existing.actor === "Carlos"
              && existing.content === String(body.content ?? "").trim()
              && JSON.stringify(existing.attachments ?? []) === JSON.stringify(body.attachments ?? [])
            );
            if (!sameRequest) throw requestError(`Message ID already exists: ${messageId}`, 409);

            const hasFollowUp = current.messages.slice(existingIndex + 1).some(message => message.actor === "Nora");
            if (hasFollowUp) {
              sendJson(200, { action: "existing", message: null, workflow: null, deduplicated: true });
              return;
            }
          } else {
            await addMessage(conversationId, {
              id: messageId,
              actor: "Carlos",
              content: body.content,
              attachments: body.attachments ?? [],
            });
          }
        } else {
          const message = await addMessage(conversationId, {
            actor: "Carlos",
            content: body.content,
            attachments: body.attachments ?? [],
          });
          messageId = message.id;
        }

        const running = nora.listCarlosRequests?.().find(job => (
          job.status === "running"
          && job.conversationId === conversationId
          && job.messageId === messageId
        ));
        const job = running ?? nora.startCarlosRequest({ conversationId, messageId });
        sendJson(202, { action: "accepted", job, deduplicated: Boolean(running) });
        return;
      }

      if (method === "DELETE" && resource === "requests" && parts.length === 4) {
        const cancelled = await nora.cancelCarlosRequest(resourceId, conversationId);
        if (!cancelled) {
          sendError(404, "Active Nora request not found");
          return;
        }
        sendJson(200, { id: resourceId, cancelled: true });
        return;
      }

      if (resource === "attachments" && parts.length === 3 && method === "GET") {
        sendJson(200, await listAttachments(conversationId));
        return;
      }

      if (resource === "attachments" && parts.length === 3 && method === "POST") {
        const body = await readJson(req);
        const attachment = await createAttachment({
          conversationId,
          name: body.name,
          type: body.type,
          createdBy: body.createdBy ?? "Carlos",
          content: body.encoding === "base64"
            ? Buffer.from(body.content ?? "", "base64")
            : body.content ?? "",
        });
        sendJson(201, attachment);
        return;
      }

      if (resource === "artifacts" && parts.length === 3 && method === "GET") {
        sendJson(200, await listArtifacts(conversationId));
        return;
      }

      if (resource === "artifacts" && parts.length === 3 && method === "POST") {
        const body = await readJson(req);
        const artifact = await createArtifact({
          conversationId,
          name: body.name,
          type: body.type,
          createdBy: body.createdBy ?? "Carlos",
          content: body.encoding === "base64"
            ? Buffer.from(body.content ?? "", "base64")
            : body.content ?? "",
        });
        sendJson(201, artifact);
        return;
      }

      if (parts.length === 4 && method === "GET" && resource === "attachments") {
        const attachment = await getAttachment(conversationId, resourceId);
        if (!attachment) {
          sendError(404, "Attachment not found");
          return;
        }
        const content = await readAttachment(conversationId, resourceId);
        const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
        res.writeHead(200, {
          ...cors,
          "Content-Type": attachment.type ?? "application/octet-stream",
          "Content-Disposition": `${disposition}; filename="${safeFilename(attachment.name)}"`,
          "Cache-Control": "no-store",
        });
        res.end(content);
        return;
      }

      if (parts.length === 4 && method === "GET" && resource === "artifacts") {
        const artifact = await getArtifact(conversationId, resourceId);
        if (!artifact) {
          sendError(404, "Artifact not found");
          return;
        }
        const content = await readArtifact(conversationId, resourceId);
        const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
        res.writeHead(200, {
          ...cors,
          "Content-Type": artifact.type ?? "application/octet-stream",
          "Content-Disposition": `${disposition}; filename="${safeFilename(artifact.name)}"`,
          "Cache-Control": "no-store",
        });
        res.end(content);
        return;
      }

      sendError(404, "Route not found");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      sendError(status, message);
    }
  };

  return { matches, handle };
};
