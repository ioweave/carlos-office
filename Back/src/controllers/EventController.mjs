import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const eventsDir = resolve(here, "../../ObsidianVault/90-System/Events");
const eventsFile = resolve(eventsDir, "events.jsonl");
const events = [];
let eventWrite = Promise.resolve();

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
      } catch (error) {
        failures.push({
          lineNumber: index + 1,
          error: error instanceof Error ? error.message : String(error),
        });
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
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    throw new Error("Event details must be an object");
  }

  const event = Object.freeze({
    ...structuredClone(details),
    type,
    at: new Date().toISOString(),
  });
  const previous = eventWrite.catch(() => {});
  const next = previous.then(async () => {
    await mkdir(eventsDir, { recursive: true });
    await appendFile(eventsFile, `${JSON.stringify(event)}\n`, "utf8");
  });

  eventWrite = next;
  await next;
  events.push(event);
  return event;
};

export const listEvents = (filters = {}) => events.filter(event => {
  for (const [key, value] of Object.entries(filters)) {
    if (event[key] !== value) return false;
  }

  return true;
});