import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { getVariable } from "../src/services/VariableService.mjs";
import { resolveWorkspacePath } from "../src/services/ExecutionWorkspaceService.mjs";

const request = async (url, options, timeoutMs, signal) => {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  const timer = setTimeout(() => controller.abort(new Error("MiniMax H3 request timed out")), timeoutMs);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 2_000);
      throw new Error(`minimax-h3: HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    return response;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
};

const tool = {
  name: "minimax-h3",
  description: "Calls a MiniMax-H3 SGLang deployment through its /v1/videos API. Supports submitting T2VA/FL2VA/Ref2VA jobs, checking status, and downloading completed video into the Agent workspace. Default endpoint is http://127.0.0.1:30010 and can be overridden with Workspace Variable integration.minimaxH3Url.",
  requiresApproval: false,
  provider: null,
  model: null,
  input: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["generate", "status", "download"] },
      id: { type: "string", description: "Video job id for status or download." },
      task: { type: "string", enum: ["t2va", "fl2va", "ref2va"], default: "t2va" },
      prompt: { type: "string", description: "H3 generation prompt." },
      conditions: { type: "array", description: "H3 conditions array for image/video/audio references.", default: [] },
      shortEdge: { type: "number", default: 768 },
      aspectRatio: { type: "string", default: "16:9" },
      durationSeconds: { type: "number", default: 10 },
      seed: { type: "number", default: 0 },
      output: { type: "string", description: "Download destination. Relative paths resolve in the Agent workspace." },
      baseUrl: { type: "string", description: "Optional H3 SGLang service URL." },
      timeoutMs: { type: "number", default: 120000 },
    },
    required: ["action"],
    additionalProperties: false,
  },
  output: { type: "object" },
  async execute(inputs = {}, context = {}) {
    const baseUrl = (inputs.baseUrl
      || getVariable("integration.minimaxH3Url")?.value
      || process.env.MINIMAX_H3_URL
      || "http://127.0.0.1:30010").replace(/\/+$/, "");
    const timeoutMs = inputs.timeoutMs ?? 120_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("minimax-h3: timeoutMs must be positive");

    if (inputs.action === "generate") {
      if (typeof inputs.prompt !== "string" || !inputs.prompt.trim()) throw new Error("minimax-h3: prompt is required for generate");
      if (!Array.isArray(inputs.conditions ?? [])) throw new Error("minimax-h3: conditions must be an array");
      const durationSeconds = inputs.durationSeconds ?? 10;
      const shortEdge = inputs.shortEdge ?? 768;
      const seed = inputs.seed ?? 0;
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("minimax-h3: durationSeconds must be positive");
      if (!Number.isSafeInteger(shortEdge) || shortEdge <= 0) throw new Error("minimax-h3: shortEdge must be a positive integer");
      if (!Number.isSafeInteger(seed)) throw new Error("minimax-h3: seed must be an integer");

      const response = await request(`${baseUrl}/v1/videos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: inputs.task || "t2va",
          prompt: inputs.prompt.trim(),
          conditions: inputs.conditions ?? [],
          target: {
            short_edge: shortEdge,
            aspect_ratio: inputs.aspectRatio || "16:9",
            duration_seconds: durationSeconds,
          },
          seed,
        }),
      }, timeoutMs, context.signal);
      return response.json();
    }

    if (typeof inputs.id !== "string" || !inputs.id.trim()) {
      throw new Error(`minimax-h3: id is required for ${inputs.action}`);
    }
    const id = encodeURIComponent(inputs.id.trim());
    if (inputs.action === "status") {
      const response = await request(`${baseUrl}/v1/videos/${id}`, { method: "GET" }, timeoutMs, context.signal);
      return response.json();
    }
    if (inputs.action === "download") {
      const output = resolveWorkspacePath(context.workspaceDir, inputs.output || `${inputs.id.trim()}.mp4`);
      const response = await request(`${baseUrl}/v1/videos/${id}/content`, { method: "GET" }, timeoutMs, context.signal);
      const content = Buffer.from(await response.arrayBuffer());
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, content);
      return { id: inputs.id.trim(), path: output, bytes: content.length };
    }
    throw new Error(`minimax-h3: unknown action ${inputs.action}`);
  },
};

export default tool;
export { tool };
