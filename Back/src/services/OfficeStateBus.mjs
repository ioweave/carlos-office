const listeners = new Set();

export const notifyOfficeStateChanged = (...domains) => {
  const changed = [...new Set(domains.flat().filter(domain => typeof domain === "string" && domain.trim()))];
  if (!changed.length) return;

  for (const listener of [...listeners]) {
    try {
      listener(changed);
    } catch (error) {
      console.error("[office-state] Change listener failed.", {
        domains: changed,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
};

export const subscribeOfficeStateChanges = listener => {
  if (typeof listener !== "function") throw new Error("Office state listener must be a function");
  listeners.add(listener);
  return () => listeners.delete(listener);
};
