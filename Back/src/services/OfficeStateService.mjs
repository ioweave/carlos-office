import { randomUUID } from "node:crypto";

const LONG_POLL_CHECK_MS = 2_000;

const wait = (milliseconds, signal) => new Promise(resolve => {
  if (signal?.aborted) return resolve(false);

  let timer = null;
  const finish = completed => {
    if (timer !== null) clearTimeout(timer);
    signal?.removeEventListener("abort", handleAbort);
    resolve(completed);
  };
  const handleAbort = () => finish(false);

  timer = setTimeout(() => finish(true), milliseconds);
  signal?.addEventListener("abort", handleAbort, { once: true });
});

const conversationRevision = conversations => JSON.stringify(
  conversations.listConversations()
    .map(conversation => {
      const lastMessage = conversation.messages?.at(-1) ?? null;
      return [
        conversation.id,
        conversation.messages?.length ?? 0,
        lastMessage?.id ?? "",
        lastMessage?.at ?? "",
      ];
    })
    .sort(([left], [right]) => left.localeCompare(right)),
);

/**
 * Tracks only office state that can change without a screen initiating a request.
 */
export const createOfficeStateService = ({ nora, processes, conversations, authorization, engine, skills }) => {
  const instance = randomUUID();
  const cache = new Map();
  let revision = 0;

  const readSnapshot = () => ({
    nora: nora.getNoraState(),
    workflows: processes.listWorkflows(),
    approvals: authorization.listApprovals(),
    agents: engine.listAgentProcesses(),
    skillsRevision: skills.getSkillsRevision(),
    conversationsRevision: conversationRevision(conversations),
  });

  const refreshCache = () => {
    const snapshot = readSnapshot();
    const changed = [];

    for (const [domain, value] of Object.entries(snapshot)) {
      const serialized = JSON.stringify(value);
      if (cache.get(domain)?.serialized === serialized) continue;
      changed.push({ domain, value, serialized });
    }

    if (!changed.length) return;
    revision += 1;
    for (const entry of changed) {
      cache.set(entry.domain, {
        value: entry.value,
        serialized: entry.serialized,
        revision,
      });
    }
  };

  const createResponse = (since, clientInstance) => {
    const reset = clientInstance !== instance || since > revision;
    const baseline = reset ? 0 : since;
    const changed = [];
    const state = {};

    for (const [domain, entry] of cache) {
      if (entry.revision <= baseline) continue;
      changed.push(domain);
      state[domain] = entry.value;
    }

    return {
      ok: true,
      instance,
      revision,
      reset,
      changed,
      state,
    };
  };

  const ping = async ({ since = 0, clientInstance = null, waitMs = 0, signal = null } = {}) => {
    if (!Number.isSafeInteger(since) || since < 0) throw new Error("Ping revision must be a non-negative integer");
    if (!Number.isSafeInteger(waitMs) || waitMs < 0) throw new Error("Ping wait must be a non-negative integer");

    const deadline = Date.now() + waitMs;
    while (!signal?.aborted) {
      refreshCache();
      const response = createResponse(since, clientInstance);
      if (response.reset || response.changed.length || waitMs === 0 || Date.now() >= deadline) return response;

      const remaining = deadline - Date.now();
      if (remaining <= 0) return response;
      const continued = await wait(Math.min(LONG_POLL_CHECK_MS, remaining), signal);
      if (!continued) return null;
    }

    return null;
  };

  return { ping };
};
