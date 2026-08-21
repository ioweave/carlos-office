import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const noraProgram = fileURLToPath(new URL("./nora.mjs", import.meta.url));
const pending = new Map();
let child = null;
let models = [];
let readyPromise = null;

const rejectPending = error => {
  for (const request of pending.values()) request.reject(error);
  pending.clear();
};

export const startNora = async () => {
  if (child && readyPromise) return readyPromise;

  readyPromise = new Promise((resolve, reject) => {
    let started = false;
    child = fork(noraProgram, [], {
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      serialization: "advanced",
    });

    child.on("message", message => {
      if (message?.type === "ready") {
        started = true;
        models = Array.isArray(message.models) ? structuredClone(message.models) : [];
        resolve(getNoraProcessState());
        return;
      }

      if (message?.type !== "decision") return;
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);

      if (message.error) request.reject(new Error(message.error));
      else request.resolve(message.result);
    });

    child.once("error", error => {
      rejectPending(error);
      if (!started) reject(error);
    });

    child.on("exit", (code, signal) => {
      const error = new Error(`Nora process exited (${signal ?? code ?? "unknown"})`);
      rejectPending(error);
      if (!started) reject(error);
      child = null;
      readyPromise = null;
      models = [];
    });
  });

  return readyPromise;
};

export const decide = async ({ definition, selection, instruction, context }) => {
  await startNora();
  if (!child?.connected) throw new Error("Nora process is not available");

  const id = randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.send({
      type: "decide",
      id,
      definition: structuredClone(definition),
      selection: structuredClone(selection),
      instruction,
      context: structuredClone(context),
    });
  });
};

export const listModels = () => structuredClone(models);

export const getNoraProcessState = () => ({
  pid: child?.pid ?? null,
  running: Boolean(child?.connected),
  status: pending.size ? "working" : "idle",
});

export const stopNora = () => {
  if (!child) return;
  rejectPending(new Error("Nora process stopped"));
  child.kill("SIGTERM");
  child = null;
  readyPromise = null;
  models = [];
};
