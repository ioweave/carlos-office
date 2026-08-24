import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { getArtifact } from "./ArtifactController.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const conversationsDir = resolve(here, "../../ObsidianVault/Conversations");
const conversations = new Map();

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
        artifacts: message.artifacts,
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
      artifacts: message.artifacts ?? [],
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
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, renderConversation(conversation), "utf8");
};

const commitConversation = async conversation => {
  await persistConversation(conversation);
  conversations.set(conversation.id, conversation);
  return structuredClone(conversation);
};

const ensureLoaded = async id => conversations.get(id) ?? loadConversation(id);

export const createConversation = async ({ id = null, nora } = {}) => {
  validateModelSelection(nora);
  const conversationId = id ?? `conversation-${randomUUID()}`;
  validateConversationId(conversationId);

  if (conversations.has(conversationId)) {
    throw new Error(`Conversation already exists: ${conversationId}`);
  }

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

  conversation.messages[index].content = content.trim();
  conversation.messages = conversation.messages.slice(0, index + 1);

  const removed = new Set(removedWorkflowIds);
  conversation.workflows = conversation.workflows.filter(workflowId => !removed.has(workflowId));
  return commitConversation(conversation);
};

export const addMessage = async (conversationId, { actor, content, artifacts = [], workflowId = null }) => {
  if (!actor || typeof actor !== "string") throw new Error("Message actor must be a non-empty string");
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Message content must be a non-empty string");
  }
  if (!Array.isArray(artifacts)) throw new Error("Message artifacts must be an array");
  if (workflowId != null && (typeof workflowId !== "string" || !workflowId.trim())) {
    throw new Error("Message Workflow ID must be a non-empty string when present");
  }

  for (const artifactId of artifacts) {
    if (!(await getArtifact(conversationId, artifactId))) throw new Error(`Unknown artifact: ${artifactId}`);
  }

  const current = await ensureLoaded(conversationId);
  const conversation = structuredClone(current);
  const message = {
    id: `message-${randomUUID()}`,
    actor,
    at: new Date().toISOString(),
    content: content.trim(),
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
