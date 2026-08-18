import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const eventsDir = resolve(
  here,
  "../../ObsidianVault/90-System/Events"
);
const eventsFile = resolve(eventsDir, "events.jsonl");
const events = [];

export const loadEvents = async () => {
  await mkdir(eventsDir, { recursive: true });

  events.length = 0;

  try {
    const content = await readFile(eventsFile, "utf8");

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;

      events.push(Object.freeze(JSON.parse(line)));
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  return [...events];
}

export const recordEvent = async (type, details = {}) => {
  if (!type || typeof type !== "string") {
    throw new Error("Event type must be a non-empty string");
  }

  if (!details || typeof details !== "object" || Array.isArray(details)) {
    throw new Error("Event details must be an object");
  }

  const event = Object.freeze({
    type,
    at: new Date().toISOString(),
    ...details
  });

  await mkdir(eventsDir, { recursive: true });
  await appendFile(eventsFile, `${JSON.stringify(event)}\n`, "utf8");

  events.push(event);

  return event;
}

export const listEvents = (filters = {}) => {
  return events.filter((event) => {
    for (const [key, value] of Object.entries(filters)) {
      if (event[key] !== value) {
        return false;
      }
    }

    return true;
  });
}