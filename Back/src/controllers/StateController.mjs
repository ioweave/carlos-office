import { watch } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const vaultDir = resolve(here, "../../ObsidianVault");
const DEFAULT_DOMAINS = ["nora", "models", "workflows", "approvals", "agents", "skillsRevision", "conversations"];
const WATCH_DEBOUNCE_MS = 50;
const stateChangeListeners = new Set();

const normalizeDomains = domains => {
  const values = Array.isArray(domains) ? domains : [domains];
  const normalized = new Set(values.filter(domain => typeof domain === "string" && domain.trim()));
  if (normalized.has("workflows") || normalized.has("agents") || normalized.has("approvals")) normalized.add("nora");
  return [...normalized];
};

const conversationSummary = conversation => {
  const messages = conversation.messages ?? [];
  const latestMessage = messages.reduce((latest, message) => (
    !latest || Date.parse(message.at ?? "") > Date.parse(latest.at ?? "") ? message : latest
  ), null);
  const firstCarlos = messages.find(message => message.actor === "Carlos");
  return {
    id: conversation.id,
    title: conversation.title ?? null,
    nora: conversation.nora ?? null,
    messageCount: messages.length,
    lastMessageId: latestMessage?.id ?? "",
    lastMessageAt: latestMessage?.at ?? "",
    lastActor: latestMessage?.actor ?? "",
    firstCarlosPreview: firstCarlos?.content?.replace(/\s+/g, " ").trim().slice(0, 56) ?? "",
  };
};

export const notifyStateChanged = (...domains) => {
  const changed = normalizeDomains(domains.flat());
  if (!changed.length) return;

  for (const listener of [...stateChangeListeners]) {
    try { listener(changed); } catch (error) {
      console.error("[state] Change listener failed.", {
        domains: changed,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
};

export const createStateController = ({ nora, processes, conversations, authorization, engine, skills }) => {
  const cache = new Map();
  const listeners = new Set();
  const watchers = [];
  let initialized = false;
  let initializePromise = null;
  let refreshQueue = Promise.resolve();
  let watchersStarted = false;

  const readers = {
    nora: () => nora.getNoraState(),
    models: () => nora.listModels(),
    workflows: () => processes.listWorkflows(),
    approvals: () => authorization.listApprovals(),
    agents: () => engine.listAgentProcesses(),
    skillsRevision: () => skills.getSkillsRevision(),
    conversations: () => conversations.listConversations().map(conversationSummary),
  };

  const currentState = () => Object.fromEntries([...cache].map(([domain, entry]) => [domain, structuredClone(entry.value)]));

  const publish = payload => {
    for (const listener of [...listeners]) {
      try { listener(structuredClone(payload)); } catch (error) {
        console.error("[state] Subscriber failed.", { message: error instanceof Error ? error.message : String(error) });
      }
    }
  };

  const refreshNow = async requestedDomains => {
    const domains = normalizeDomains(requestedDomains).filter(domain => readers[domain]);
    if (!domains.length) return false;

    const changed = [];
    const state = {};
    for (const domain of domains) {
      const value = await readers[domain]();
      const serialized = JSON.stringify(value);
      if (cache.get(domain)?.serialized === serialized) continue;
      cache.set(domain, { value, serialized });
      changed.push(domain);
      state[domain] = structuredClone(value);
    }
    if (!changed.length) return false;
    if (initialized) publish({ changed, state });
    return true;
  };

  const invalidate = domains => {
    const requested = normalizeDomains(domains);
    const next = refreshQueue.catch(() => {}).then(() => refreshNow(requested));
    refreshQueue = next;
    return next;
  };

  const refresh = () => invalidate(DEFAULT_DOMAINS);

  const watchDurableState = (path, domains, recursive = true) => {
    let timer = null;
    try {
      const watcher = watch(path, { recursive }, () => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          void invalidate(domains).catch(error => {
            console.error("[state] Could not refresh watched state.", {
              path,
              domains,
              message: error instanceof Error ? error.message : String(error),
            });
          });
        }, WATCH_DEBOUNCE_MS);
      });
      watcher.on("error", error => {
        console.error("[state] State watcher failed.", { path, message: error instanceof Error ? error.message : String(error) });
      });
      watchers.push({ close: () => {
        if (timer !== null) clearTimeout(timer);
        watcher.close();
      } });
    } catch (error) {
      console.error("[state] Could not watch durable state.", { path, message: error instanceof Error ? error.message : String(error) });
    }
  };

  const startWatchers = () => {
    if (watchersStarted) return;
    watchersStarted = true;
    watchDurableState(resolve(vaultDir, "Conversations"), ["conversations"]);
    watchDurableState(resolve(vaultDir, "System/Workflows"), ["workflows"]);
    watchDurableState(resolve(vaultDir, "System/Runtime/Authorizations"), ["approvals"]);
    watchDurableState(resolve(vaultDir, "System/Nora.md"), ["nora"], false);
  };

  const initialize = () => {
    if (initialized) return Promise.resolve();
    if (initializePromise) return initializePromise;
    initializePromise = refresh().then(() => {
      initialized = true;
      startWatchers();
    }).finally(() => { initializePromise = null; });
    return initializePromise;
  };

  const snapshot = async () => {
    await initialize();
    return currentState();
  };

  const subscribe = listener => {
    if (typeof listener !== "function") throw new Error("State subscriber must be a function");
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const handleStateChange = domains => {
    void invalidate(domains).catch(error => {
      console.error("[state] Could not refresh changed state.", {
        domains,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  };
  stateChangeListeners.add(handleStateChange);

  const dispose = () => {
    stateChangeListeners.delete(handleStateChange);
    for (const watcher of watchers) watcher.close();
    watchers.length = 0;
    listeners.clear();
  };

  return { initialize, invalidate, refresh, snapshot, subscribe, dispose };
};
