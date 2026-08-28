import { spawn } from "node:child_process";

const MAX_OUTPUT_BYTES = 2_000_000;

export const runExternalCommand = ({
  command,
  args = [],
  cwd = null,
  input = null,
  env = {},
  timeoutMs = 300_000,
  signal = null,
}) => new Promise((resolve, reject) => {
  if (typeof command !== "string" || !command.trim()) throw new Error("External command must be a non-empty string");
  if (!Array.isArray(args) || args.some(arg => typeof arg !== "string")) throw new Error("External command args must be strings");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("External command timeoutMs must be positive");

  const child = spawn(command.trim(), args, {
    cwd: cwd || undefined,
    env: { ...process.env, ...env },
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let bytes = 0;
  let settled = false;

  const finish = (error, result = null) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    if (error) reject(error);
    else resolve(result);
  };
  const fail = (message, code, retryable = false) => {
    const error = new Error(message);
    error.code = code;
    error.retryable = retryable;
    return error;
  };
  const collect = target => chunk => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_OUTPUT_BYTES) {
      child.kill("SIGTERM");
      finish(fail(`External command output exceeds ${MAX_OUTPUT_BYTES} bytes`, "external_output_too_large"));
      return;
    }
    if (target === "stdout") stdout += buffer.toString("utf8");
    else stderr += buffer.toString("utf8");
  };
  const abort = () => {
    child.kill("SIGTERM");
    finish(fail("External command cancelled", "external_command_cancelled", true));
  };
  const timer = setTimeout(() => {
    child.kill("SIGTERM");
    finish(fail(`External command exceeded ${timeoutMs} ms`, "external_command_timeout", true));
  }, timeoutMs);

  child.stdout.on("data", collect("stdout"));
  child.stderr.on("data", collect("stderr"));
  child.on("error", error => finish(error));
  child.on("close", code => {
    if (settled) return;
    if (code !== 0) {
      const detail = stderr.trim() || stdout.trim() || `exit code ${code}`;
      finish(fail(`External command failed: ${detail}`, "external_command_failed"));
      return;
    }
    finish(null, { stdout: stdout.trim(), stderr: stderr.trim() });
  });

  if (signal?.aborted) {
    abort();
    return;
  }
  signal?.addEventListener("abort", abort, { once: true });
  child.stdin.end(input == null ? undefined : String(input));
});
