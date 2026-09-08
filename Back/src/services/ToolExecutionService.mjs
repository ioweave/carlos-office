import { setTimeout as delay } from "node:timers/promises";

import { validateToolOutput } from "../registry/Tools.mjs";

const TRANSIENT_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "http_timeout", "http_transient_status"]);

export const toolCanReplay = (tool, input = {}) => tool?.replay === "safe"
  || (tool?.replay === "http-read" && ["GET", "HEAD", "OPTIONS"].includes(String(input.method || "GET").toUpperCase()));

/** Execute one validated Tool call. Only declared safe reads receive bounded retries. */
export const executeTool = async (tool, input, context) => {
  const replaySafe = toolCanReplay(tool, input);
  const timeoutMs = input.timeoutMs ?? tool.timeoutMs ?? 300_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 7_200_000) {
    throw Object.assign(new Error("Tool timeoutMs must be an integer from 1000 to 7200000"), {
      code: "tool_input_invalid", retryable: false, sideEffect: "none", hint: "Correct timeoutMs before executing the Tool.",
    });
  }
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = context.signal ? AbortSignal.any([context.signal, deadline]) : deadline;
  let started = false;
  let attempts = 0;
  for (let attempt = 1; attempt <= (replaySafe ? 3 : 1); attempt += 1) {
    let onAbort;
    try {
      signal.throwIfAborted();
      attempts = attempt;
      const cancelled = new Promise((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
      });
      started = true;
      const result = await Promise.race([tool.execute(input, { ...context, signal }), cancelled]);
      validateToolOutput(tool, result);
      return { result, attempts, replaySafe, sideEffect: replaySafe ? "none" : "possible" };
    } catch (cause) {
      const code = context.signal?.aborted ? "tool_cancelled"
        : deadline.aborted ? "tool_timeout" : cause?.code || cause?.cause?.code || "tool_execution_failed";
      const transient = cause?.retryable === false ? false : cause?.retryable === true || TRANSIENT_CODES.has(code);
      const retryable = replaySafe && transient && !signal.aborted;
      if (retryable && attempt < 3) {
        const waitMs = Math.max(500 * 2 ** (attempt - 1), Number(cause.retryAfterMs) || 0);
        // Do not violate a server's Retry-After by clipping it to a shorter delay.
        if (waitMs <= 30_000) {
          try { await delay(waitMs, undefined, { signal }); } catch { /* Report the abort below. */ }
          if (!signal.aborted) continue;
        }
      }
      const error = new Error(context.signal?.aborted ? "Tool execution cancelled"
        : deadline.aborted ? `Tool exceeded ${timeoutMs} ms` : cause?.message || String(cause), { cause });
      Object.assign(error, {
        code: context.signal?.aborted ? "tool_cancelled" : deadline.aborted ? "tool_timeout" : code,
        retryable: false,
        transient,
        replaySafe,
        attempts,
        sideEffect: !started || replaySafe ? "none" : "unknown",
        hint: cause?.hint || (replaySafe
          ? "Inspect the failure and change the request or resume later; automatic retries are exhausted."
          : "Inspect the action's outcome before retrying; it may already have taken effect."),
      });
      throw error;
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  }
};
