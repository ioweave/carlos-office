import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { recordEvent } from "./EventController.mjs";
import { createWorkflow, getProcess } from "./ProcessController.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const schedulesDir = resolve(here, "../../ObsidianVault/System/Schedules");
const schedules = new Map();

let schedulerTimer = null;
let ticking = false;

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

const validateFileName = (value, label) => {
  if (
    typeof value !== "string"
    || !value.trim()
    || value.trim() !== value
    || value === "."
    || value === ".."
    || /[<>:"/\\|?*\u0000-\u001F]/.test(value)
  ) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
};

const schedulePath = id => {
  validateFileName(id, "schedule ID");
  return resolve(schedulesDir, `${id}.json`);
};

const requireSchedule = id => {
  const schedule = schedules.get(id);
  if (!schedule) throw new Error(`Unknown schedule: ${id}`);
  return schedule;
};

const persistSchedule = async schedule => {
  await mkdir(schedulesDir, { recursive: true });
  await writeFile(schedulePath(schedule.id), JSON.stringify(schedule, null, 2), "utf8");
};

const parseNumber = (value, min, max, label) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`Invalid cron ${label}: ${value}`);
  }
  return number;
};

const parseCronField = (field, min, max, label, normalize = value => value) => {
  if (typeof field !== "string" || !field.trim()) throw new Error(`Invalid cron ${label}`);

  const values = new Set();

  for (const part of field.split(",")) {
    const pieces = part.split("/");
    if (pieces.length > 2) throw new Error(`Invalid cron ${label}: ${field}`);

    const base = pieces[0];
    const step = pieces.length === 2 ? parseNumber(pieces[1], 1, max - min + 1, `${label} step`) : 1;
    let start;
    let end;

    if (base === "*") {
      start = min;
      end = max;
    } else if (base.includes("-")) {
      const range = base.split("-");
      if (range.length !== 2) throw new Error(`Invalid cron ${label}: ${part}`);

      start = parseNumber(range[0], min, max, label);
      end = parseNumber(range[1], min, max, label);
      if (start > end) throw new Error(`Invalid cron ${label} range: ${part}`);
    } else {
      start = parseNumber(base, min, max, label);
      end = pieces.length === 2 ? max : start;
    }

    for (let value = start; value <= end; value += step) values.add(normalize(value));
  }

  return { values, wildcard: field === "*" };
};

const parseCron = expression => {
  if (typeof expression !== "string" || !expression.trim()) {
    throw new Error("Cron expression must be a non-empty string");
  }

  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error("Cron expression must contain 5 fields");

  return {
    minute: parseCronField(fields[0], 0, 59, "minute"),
    hour: parseCronField(fields[1], 0, 23, "hour"),
    dayOfMonth: parseCronField(fields[2], 1, 31, "day-of-month"),
    month: parseCronField(fields[3], 1, 12, "month"),
    dayOfWeek: parseCronField(fields[4], 0, 7, "day-of-week", value => value === 7 ? 0 : value),
  };
};

const cronMatches = (date, cron) => {
  if (!cron.minute.values.has(date.getUTCMinutes())) return false;
  if (!cron.hour.values.has(date.getUTCHours())) return false;
  if (!cron.month.values.has(date.getUTCMonth() + 1)) return false;

  const dayOfMonthMatches = cron.dayOfMonth.values.has(date.getUTCDate());
  const dayOfWeekMatches = cron.dayOfWeek.values.has(date.getUTCDay());

  if (!cron.dayOfMonth.wildcard && !cron.dayOfWeek.wildcard) return dayOfMonthMatches || dayOfWeekMatches;
  if (!cron.dayOfMonth.wildcard && !dayOfMonthMatches) return false;
  if (!cron.dayOfWeek.wildcard && !dayOfWeekMatches) return false;
  return true;
};

const nextCronDate = (expression, after = new Date()) => {
  const cron = parseCron(expression);
  const candidate = new Date(after.getTime());
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  const maxMinutes = 60 * 24 * 366 * 2;
  for (let index = 0; index < maxMinutes; index += 1) {
    if (cronMatches(candidate, cron)) return candidate;
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }

  throw new Error(`Could not find next cron occurrence: ${expression}`);
};

const normalizeUtcTimestamp = (value, label, nullable = true) => {
  if (nullable && value == null) return null;
  const date = new Date(value);
  if (typeof value !== "string" || Number.isNaN(date.getTime())) throw new Error(`Invalid ${label}: ${value}`);
  return date.toISOString();
};

const normalizeTiming = timing => {
  if (!isObject(timing)) throw new Error("Schedule timing must be an object");

  if (timing.type === "at") {
    return {
      type: "at",
      value: normalizeUtcTimestamp(timing.value, "one-time schedule", false),
    };
  }

  if (timing.type === "cron") {
    parseCron(timing.value);
    return { type: "cron", value: timing.value.trim() };
  }

  throw new Error(`Unsupported schedule type: ${timing.type}`);
};

export const validateScheduleTiming = timing => {
  normalizeTiming(timing);
  return true;
};

const validateSchedule = schedule => {
  if (!isObject(schedule)) throw new Error("Schedule must be an object");
  validateFileName(schedule.id, "schedule ID");

  if (!schedule.process || typeof schedule.process !== "string") {
    throw new Error("Schedule process must be a non-empty string");
  }
  if (!getProcess(schedule.process)) throw new Error(`Schedule references unknown Process: ${schedule.process}`);
  if (typeof schedule.enabled !== "boolean") throw new Error("Schedule enabled must be a boolean");
  if (!isObject(schedule.inputs)) throw new Error("Schedule inputs must be an object");
  if (!isObject(schedule.config)) throw new Error("Schedule config must be an object");

  normalizeTiming(schedule.timing);
  if (schedule.lastRunAt != null) normalizeUtcTimestamp(schedule.lastRunAt, "schedule lastRunAt");
  if (schedule.nextRunAt != null) normalizeUtcTimestamp(schedule.nextRunAt, "schedule nextRunAt");
};

const calculateNextRun = (schedule, after = new Date()) => {
  if (!schedule.enabled) return null;

  if (schedule.timing.type === "at") {
    if (schedule.lastRunAt) return null;
    return normalizeUtcTimestamp(schedule.timing.value, "one-time schedule", false);
  }

  return nextCronDate(schedule.timing.value, after).toISOString();
};

const recordLoadFailure = async (filename, error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[schedules] Could not load Schedule.", { filename, message });

  try {
    await recordEvent("schedule.load_failed", { filename, error: message });
  } catch (eventError) {
    console.error("[schedules] Could not record Schedule load failure.", {
      filename,
      message: eventError instanceof Error ? eventError.message : String(eventError),
    });
  }
};

const normalizeStoredSchedule = stored => ({
  inputs: {},
  config: {},
  lastRunAt: null,
  nextRunAt: null,
  ...structuredClone(stored),
  timing: normalizeTiming(stored.timing),
  lastRunAt: stored.lastRunAt == null ? null : normalizeUtcTimestamp(stored.lastRunAt, "schedule lastRunAt"),
});

export const loadSchedules = async () => {
  await mkdir(schedulesDir, { recursive: true });
  schedules.clear();

  const files = await readdir(schedulesDir);
  for (const filename of files.filter(file => file.endsWith(".json"))) {
    try {
      const schedule = normalizeStoredSchedule(JSON.parse(await readFile(resolve(schedulesDir, filename), "utf8")));
      validateSchedule(schedule);
      if (schedules.has(schedule.id)) throw new Error(`Duplicate schedule ID: ${schedule.id}`);

      schedule.nextRunAt = calculateNextRun(schedule, new Date());
      await persistSchedule(schedule);
      schedules.set(schedule.id, schedule);
    } catch (error) {
      await recordLoadFailure(filename, error);
    }
  }

  return listSchedules();
};

export const getSchedule = id => {
  const schedule = schedules.get(id);
  return schedule ? structuredClone(schedule) : null;
};

export const listSchedules = () => [...schedules.values()].map(schedule => structuredClone(schedule));

export const deleteSchedulesForProcess = async processName => {
  const matches = [...schedules.values()].filter(schedule => schedule.process === processName);

  for (const schedule of matches) {
    await rm(schedulePath(schedule.id), { force: true });
    schedules.delete(schedule.id);
    await recordEvent("schedule.deleted", { scheduleId: schedule.id, process: processName });
  }

  return matches.map(schedule => schedule.id);
};

export const createSchedule = async ({
  id = `schedule-${randomUUID()}`,
  process,
  enabled = true,
  timing,
  inputs = {},
  config = {},
}) => {
  if (schedules.has(id)) throw new Error(`Schedule already exists: ${id}`);

  const schedule = {
    id,
    process,
    enabled,
    timing: normalizeTiming(timing),
    inputs: structuredClone(inputs),
    config: structuredClone(config),
    lastRunAt: null,
    nextRunAt: null,
  };

  validateSchedule(schedule);
  schedule.nextRunAt = calculateNextRun(schedule);
  await persistSchedule(schedule);
  schedules.set(id, schedule);

  await recordEvent("schedule.created", { scheduleId: id, process });
  return structuredClone(schedule);
};

export const saveSchedule = async schedule => {
  const stored = normalizeStoredSchedule(schedule);
  validateSchedule(stored);
  stored.nextRunAt = calculateNextRun(stored, new Date());
  await persistSchedule(stored);
  schedules.set(stored.id, stored);

  await recordEvent("schedule.saved", { scheduleId: stored.id, process: stored.process });
  return structuredClone(stored);
};

export const updateSchedule = async (id, changes) => {
  if (!isObject(changes)) throw new Error("Schedule changes must be an object");

  const current = requireSchedule(id);
  if (changes.id && changes.id !== id) throw new Error("Schedule ID cannot be changed");

  const normalizedChanges = structuredClone(changes);
  if (Object.prototype.hasOwnProperty.call(normalizedChanges, "timing")) {
    normalizedChanges.timing = normalizeTiming(normalizedChanges.timing);
  }

  const updated = { ...current, ...normalizedChanges, id };
  validateSchedule(updated);

  const timingChanged = Object.prototype.hasOwnProperty.call(changes, "timing");
  const enabledChanged = Object.prototype.hasOwnProperty.call(changes, "enabled");
  const processChanged = Object.prototype.hasOwnProperty.call(changes, "process");
  if (timingChanged || enabledChanged || processChanged) {
    updated.nextRunAt = calculateNextRun(updated, new Date());
  }

  await persistSchedule(updated);
  schedules.set(id, updated);
  await recordEvent("schedule.updated", { scheduleId: id });
  return structuredClone(updated);
};

export const setScheduleEnabled = async (id, enabled) => {
  if (typeof enabled !== "boolean") throw new Error("Schedule enabled must be a boolean");

  const current = requireSchedule(id);
  const updated = { ...current, enabled };
  updated.nextRunAt = calculateNextRun(updated, new Date());

  await persistSchedule(updated);
  schedules.set(id, updated);
  await recordEvent(enabled ? "schedule.enabled" : "schedule.disabled", { scheduleId: id });
  return structuredClone(updated);
};

export const triggerSchedule = async id => {
  const current = requireSchedule(id);
  if (!current.enabled) throw new Error(`Schedule ${id} is disabled`);

  const workflow = await createWorkflow(
    current.process,
    structuredClone(current.inputs),
    structuredClone(current.config),
  );

  const now = new Date();
  const updated = structuredClone(current);
  updated.lastRunAt = now.toISOString();

  if (updated.timing.type === "at") {
    updated.enabled = false;
    updated.nextRunAt = null;
  } else {
    updated.nextRunAt = calculateNextRun(updated, now);
  }

  await persistSchedule(updated);
  schedules.set(id, updated);
  await recordEvent("schedule.triggered", {
    scheduleId: id,
    process: updated.process,
    workflowId: workflow.id,
  });

  return workflow;
};

export const tickSchedules = async (now = new Date()) => {
  if (ticking) return [];

  ticking = true;
  const createdWorkflows = [];

  try {
    for (const schedule of schedules.values()) {
      if (!schedule.enabled || !schedule.nextRunAt) continue;

      const due = new Date(schedule.nextRunAt);
      if (Number.isNaN(due.getTime())) {
        await recordEvent("schedule.failed", {
          scheduleId: schedule.id,
          process: schedule.process,
          error: `Invalid nextRunAt: ${schedule.nextRunAt}`,
        });
        continue;
      }
      if (due.getTime() > now.getTime()) continue;

      try {
        createdWorkflows.push(await triggerSchedule(schedule.id));
      } catch (error) {
        await recordEvent("schedule.failed", {
          scheduleId: schedule.id,
          process: schedule.process,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return createdWorkflows;
  } finally {
    ticking = false;
  }
};

export const startScheduler = (onWorkflow, intervalMs = 30_000) => {
  if (schedulerTimer) return;
  if (typeof onWorkflow !== "function") throw new Error("Scheduler requires a Workflow runner");
  if (!Number.isInteger(intervalMs) || intervalMs < 1000) {
    throw new Error("Scheduler interval must be at least 1000ms");
  }

  const check = async () => {
    const workflows = await tickSchedules();
    await Promise.all(workflows.map(workflow => onWorkflow(workflow)));
  };

  void check().catch(error => console.error("Schedule check failed:", error));
  schedulerTimer = setInterval(() => {
    void check().catch(error => console.error("Schedule check failed:", error));
  }, intervalMs);
  schedulerTimer.unref?.();
};

export const stopScheduler = () => {
  if (!schedulerTimer) return;
  clearInterval(schedulerTimer);
  schedulerTimer = null;
};
