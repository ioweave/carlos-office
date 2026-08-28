import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { notifyOfficeStateChanged } from "../services/OfficeStateBus.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const eventsDir = resolve(here, "../../ObsidianVault/System/Events");
const archiveDir = resolve(eventsDir, "archive");
const eventsFile = resolve(eventsDir, "events.jsonl");
const MAX_EVENTS_IN_MEMORY = 20_000;
const MAX_ACTIVE_EVENT_FILE_BYTES = 50_000_000;
const events = [];
let eventWrite = Promise.resolve();

const domainsForEvent = type => {
  if (/^(?:agent|attempt|task|tool|workflow)\./.test(type)) return ["workflows", "agents", "nora"];
  if (/^approval\./.test(type)) return ["approvals", "nora"];
  if (/^nora\./.test(type)) return ["conversations", "nora"];
  if (/^(?:schedule|process)\./.test(type)) return ["workflows", "nora"];
  return [];
};

const trimMemory = () => {
  if (events.length > MAX_EVENTS_IN_MEMORY) events.splice(0, events.length - MAX_EVENTS_IN_MEMORY);
};

const rotateIfNeeded = async () => {
  let size = 0;
  try { size = (await stat(eventsFile)).size; } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (size < MAX_ACTIVE_EVENT_FILE_BYTES) return;
  await mkdir(archiveDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await rename(eventsFile, resolve(archiveDir, `events-${stamp}.jsonl`));
};

export const loadEvents = async () => {
  await eventWrite.catch(() => {});
  await mkdir(eventsDir, { recursive: true });
  events.length = 0;
  const failures = [];

  try {
    const content = await readFile(eventsFile, "utf8");
    for (const [index, line] of content.split("\n").entries()) {
      if (!line.trim()) continue;
      try {
        events.push(Object.freeze(JSON.parse(line)));
        trimMemory();
      } catch (error) {
        failures.push({ lineNumber: index + 1, error: error instanceof Error ? error.message : String(error) });
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  for (const failure of failures) {
    console.error("[events] Skipped malformed persisted Event.", failure);
    await recordEvent("event.load_failed", failure);
  }
  return [...events];
};

export const recordEvent = async (type, details = {}) => {
  if (!type || typeof type !== "string") throw new Error("Event type must be a non-empty string");
  if (!details || typeof details !== "object" || Array.isArray(details)) throw new Error("Event details must be an object");

  const event = Object.freeze({ ...structuredClone(details), type, at: new Date().toISOString() });
  const previous = eventWrite.catch(() => {});
  const next = previous.then(async () => {
    await mkdir(eventsDir, { recursive: true });
    await rotateIfNeeded();
    await appendFile(eventsFile, `${JSON.stringify(event)}\n`, "utf8");
  });
  eventWrite = next;

  const domains = domainsForEvent(type);
  if (domains.length) notifyOfficeStateChanged(domains);

  await next;
  events.push(event);
  trimMemory();
  return event;
};

export const listEvents = (filters = {}) => events.filter(event => {
  for (const [key, value] of Object.entries(filters)) if (event[key] !== value) return false;
  return true;
});
