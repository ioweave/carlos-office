import { randomUUID } from "node:crypto";

import { subscribeOfficeStateChanges } from "./OfficeStateBus.mjs";

const DEFAULT_DOMAINS = [
  "nora",
  "models",
  "workflows",
  "approvals",
  "agents",
  "skillsRevision",
  "conversations",
  "attachments",
  "artifacts",
];

const normalizeDomains = domains => {
  const values = Array.isArray(domains) ? domains : [domains];
  const normalized = new Set(values.filter(domain => typeof domain === "string" && domain.trim()));

  if (normalized.has("workflows") || normalized.has("agents") || normalized.has("approvals")) {
    normalized.add("nora");
  }
  if (normalized.has("conversations")) {
    normalized.add("attachments");
    normalized.add("artifacts");
  }

  return [...normalized];
};

/**
 * Central, revisioned application-state cache shared by /ping and WebSocket transports.
 * Controllers notify the process-local OfficeStateBus after durable mutations; this service
 * refreshes only those domains and pushes a revision to connected clients.
 */
export const createOfficeStateService = ({
  nora,
  processes,
  conversations,
  authorization,
  engine,
  skills,
  attachments,
  artifacts,
}) => {
  const instance = randomUUID();
  const cache = new Map();
  const listeners = new Set();
  let revision = 0;
  let initialized = false;
  let initializePromise = null;
  let refreshQueue = Promise.resolve();

  const conversationResourceMap = async listResource => {
    const records = conversations.listConversations();
    const entries = await Promise.all(records.map(async conversation => [
      conversation.id,
      await listResource(conversation.id),
    ]));
    return Object.fromEntries(entries);
  };

  const readers = {
    nora: () => nora.getNoraState(),
    models: () => nora.listModels(),
    workflows: () => processes.listWorkflows(),
    approvals: () => authorization.listApprovals(),
    agents: () => engine.listAgentProcesses(),
    skillsRevision: () => skills.getSkillsRevision(),
    conversations: () => conversations.listConversations(),
    attachments: () => conversationResourceMap(attachments.listAttachments),
    artifacts: () => conversationResourceMap(artifacts.listArtifacts),
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

  const notifyListeners = () => {
    for (const listener of [...listeners]) {
      try {
        listener(revision);
      } catch (error) {
        console.error("[office-state] Subscriber failed.", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  const refreshNow = async requestedDomains => {
    const domains = normalizeDomains(requestedDomains).filter(domain => readers[domain]);
    if (!domains.length) return false;

    const changed = [];
    for (const domain of domains) {
      const value = await readers[domain]();
      const serialized = JSON.stringify(value);
      if (cache.get(domain)?.serialized === serialized) continue;
      changed.push({ domain, value, serialized });
    }

    if (!changed.length) return false;

    revision += 1;
    for (const entry of changed) {
      cache.set(entry.domain, {
        value: entry.value,
        serialized: entry.serialized,
        revision,
      });
    }
    notifyListeners();
    return true;
  };

  const invalidate = domains => {
    const requested = normalizeDomains(domains);
    const next = refreshQueue.catch(() => {}).then(() => refreshNow(requested));
    refreshQueue = next;
    return next;
  };

  const initialize = () => {
    if (initialized) return Promise.resolve();
    if (initializePromise) return initializePromise;

    initializePromise = invalidate(DEFAULT_DOMAINS).then(() => {
      initialized = true;
    }).finally(() => {
      initializePromise = null;
    });
    return initializePromise;
  };

  const subscribe = listener => {
    if (typeof listener !== "function") throw new Error("Office state subscriber must be a function");
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const ping = async ({ since = 0, clientInstance = null, waitMs = 0, signal = null } = {}) => {
    if (!Number.isSafeInteger(since) || since < 0) throw new Error("Ping revision must be a non-negative integer");
    if (!Number.isSafeInteger(waitMs) || waitMs < 0) throw new Error("Ping wait must be a non-negative integer");

    await initialize();
    const immediate = createResponse(since, clientInstance);
    if (immediate.reset || immediate.changed.length || waitMs === 0 || signal?.aborted) return immediate;

    return new Promise(resolve => {
      let settled = false;
      let timer = null;
      let unsubscribe = null;

      const finish = payload => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        signal?.removeEventListener("abort", handleAbort);
        unsubscribe?.();
        resolve(payload);
      };
      const handleAbort = () => finish(null);
      const handleRevision = () => {
        const response = createResponse(since, clientInstance);
        if (response.reset || response.changed.length) finish(response);
      };

      unsubscribe = subscribe(handleRevision);
      timer = setTimeout(() => finish(createResponse(since, clientInstance)), waitMs);
      signal?.addEventListener("abort", handleAbort, { once: true });

      // Close the tiny race between the immediate check and subscriber registration.
      handleRevision();
    });
  };

  const responseSince = async ({ since = 0, clientInstance = null } = {}) => {
    await initialize();
    return createResponse(since, clientInstance);
  };

  const unsubscribeBus = subscribeOfficeStateChanges(domains => {
    void invalidate(domains).catch(error => {
      console.error("[office-state] Could not refresh changed state.", {
        domains,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });

  const dispose = () => {
    unsubscribeBus();
    listeners.clear();
  };

  return {
    initialize,
    invalidate,
    ping,
    responseSince,
    subscribe,
    dispose,
    get instance() { return instance; },
    get revision() { return revision; },
  };
};
