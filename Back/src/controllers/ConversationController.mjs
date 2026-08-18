import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getArtifact } from "./ArtifactController.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const conversationsDir = resolve(here, "../../ObsidianVault/30-Conversations");
const conversations = new Map();

const validateConversationId = (id) => {
  if (
    typeof id !== "string" ||
    !id.trim() ||
    basename(id) !== id ||
    id === "." ||
    id === ".."
  ) {
    throw new Error(`Invalid conversation ID: ${id}`);
  }
}

const validateModelSelection = (selection) => {
  if (
    !selection ||
    typeof selection !== "object" ||
    !selection.provider ||
    typeof selection.provider !== "string" ||
    !selection.model ||
    typeof selection.model !== "string"
  ) {
    throw new Error("Conversation must have a Nora provider and model");
  }
}

const conversationPath = (id) => {
  validateConversationId(id);

  return resolve(conversationsDir, id, "thread.md");
}

const renderConversation = (conversation) => {
  const metadata = JSON.stringify({
    id: conversation.id,
    nora: conversation.nora,
    workflows: conversation.workflows,
  });

  const messages = conversation.messages
    .map((message) => {
      const messageMetadata = JSON.stringify({
        id: message.id,
        actor: message.actor,
        at: message.at,
        artifacts: message.artifacts,
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
}

const parseConversation = (content, fallbackId) => {
  const match = content.match(/<!-- carlos-office:conversation (.+?) -->/);

  const metadata = match
    ? JSON.parse(match[1])
    : {
        id: fallbackId,
        workflows: [],
      };

  const messages = [];

  const pattern =
    /<!-- carlos-office:message (.+?) -->\s*\n([\s\S]*?)\n\s*<!-- \/carlos-office:message -->/g;

  for (const entry of content.matchAll(pattern)) {
    const meta = JSON.parse(entry[1]);

    messages.push({
      id: meta.id,
      actor: meta.actor,
      at: meta.at,
      content: entry[2].trim(),
      artifacts: meta.artifacts ?? [],
    });
  }

  return {
    id: metadata.id ?? fallbackId,
    path: conversationPath(metadata.id ?? fallbackId),
    nora: metadata.nora ?? null,
    messages,
    workflows: metadata.workflows ?? [],
  };
}

const  persistConversation = async (conversation) => {
  const path = conversationPath(conversation.id);

  await mkdir(dirname(path), { recursive: true });

  await writeFile(path, renderConversation(conversation), "utf8");
}

const  ensureLoaded = async (id) => {
  if (conversations.has(id)) {
    return conversations.get(id);
  }

  return loadConversation(id);
}

export const  createConversation = async ({ id = null, nora } = {}) => {
  validateModelSelection(nora);

  const conversationId = id ?? `conversation-${randomUUID()}`;

  validateConversationId(conversationId);

  if (conversations.has(conversationId)) {
    throw new Error(`Conversation already exists: ${conversationId}`);
  }

  const conversation = {
    id: conversationId,
    path: conversationPath(conversationId),

    nora: {
      provider: nora.provider.trim(),
      model: nora.model.trim(),
    },

    messages: [],
    workflows: [],
  };

  conversations.set(conversationId, conversation);

  await persistConversation(conversation);

  return conversation;
}

export const  loadConversation = async (id) => {
  validateConversationId(id);

  const conversation = parseConversation(
    await readFile(conversationPath(id), "utf8"),
    id,
  );

  conversations.set(id, conversation);

  return conversation;
}

export const  loadConversations = async () => {
  await mkdir(conversationsDir, { recursive: true });

  conversations.clear();

  const entries = await readdir(conversationsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    try {
      await loadConversation(entry.name);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  return listConversations();
}

export const  getConversation = async (id) => {
  try {
    return await ensureLoaded(id);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export function listConversations() {
  return [...conversations.values()];
}

export const  setConversationNoraModel = async (conversationId, selection) => {
  validateModelSelection(selection);

  const conversation = await ensureLoaded(conversationId);

  conversation.nora = {
    provider: selection.provider.trim(),
    model: selection.model.trim(),
  };

  await persistConversation(conversation);

  return conversation;
}

export const addMessage = async (
  conversationId,
  { actor, content, artifacts = [] },
) => {
  if (!actor || typeof actor !== "string") {
    throw new Error("Message actor must be a non-empty string");
  }

  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Message content must be a non-empty string");
  }

  if (!Array.isArray(artifacts)) {
    throw new Error("Message artifacts must be an array");
  }

  const conversation = await ensureLoaded(conversationId);

  for (const artifactId of artifacts) {
    if (!(await getArtifact(conversationId, artifactId))) {
      throw new Error(`Unknown artifact: ${artifactId}`);
    }
  }

  const message = {
    id: `message-${randomUUID()}`,
    actor,
    at: new Date().toISOString(),
    content: content.trim(),
    artifacts: [...artifacts],
  };

  conversation.messages.push(message);

  await persistConversation(conversation);

  return message;
}

export const  addArtifactToMessage = async (
  conversationId,
  messageId,
  artifactId,
) => {
  const conversation = await ensureLoaded(conversationId);

  const message = conversation.messages.find((item) => item.id === messageId);

  if (!message) {
    throw new Error(`Unknown message: ${messageId}`);
  }

  if (!(await getArtifact(conversationId, artifactId))) {
    throw new Error(`Unknown artifact: ${artifactId}`);
  }

  if (!message.artifacts.includes(artifactId)) {
    message.artifacts.push(artifactId);
  }

  await persistConversation(conversation);

  return message;
}

export const  addWorkflow = async (conversationId, workflowId) => {
  if (!workflowId || typeof workflowId !== "string") {
    throw new Error("Workflow ID must be a non-empty string");
  }

  const conversation = await ensureLoaded(conversationId);

  if (!conversation.workflows.includes(workflowId)) {
    conversation.workflows.push(workflowId);

    await persistConversation(conversation);
  }

  return conversation;
}
