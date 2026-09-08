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
  rejectOnNonZero = true,
}) => new Promise((resolve, reject) => {
  if (typeof command !== "string" || !command.trim()) throw new Error("External command must be a non-empty string");
  if (!Array.isArray(args) || args.some(arg => typeof arg !== "string")) throw new Error("External command args must be strings");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("External command timeoutMs must be positive");

  if (signal?.aborted) { reject(signal.reason); return; }
  const child = spawn(command.trim(), args, {
    cwd: cwd || undefined,
    env: { ...process.env, ...env },
    shell: false,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let bytes = 0;
  let settled = false;
  let killTimer = null;
  let terminalError = null;
  const kill = mode => {
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, mode);
      else child.kill(mode);
    } catch (error) {
      if (error.code !== "ESRCH") console.error("[command] Could not stop command", { code: error.code });
    }
  };
  const terminate = () => {
    kill("SIGTERM");
    killTimer ??= setTimeout(() => kill("SIGKILL"), 1000);
    killTimer.unref?.();
  };

  const finish = (error, result = null) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    if (error) reject(error);
    else resolve(result);
  };
  const fail = (message, code, retryable = false, details = {}) => {
    const error = new Error(message);
    error.code = code;
    error.retryable = retryable;
    Object.assign(error, details);
    return error;
  };
  const collect = target => chunk => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_OUTPUT_BYTES) {
      terminalError ??= fail(`External command output exceeds ${MAX_OUTPUT_BYTES} bytes`, "external_output_too_large");
      terminate();
      return;
    }
    if (target === "stdout") stdout += buffer.toString("utf8");
    else stderr += buffer.toString("utf8");
  };
  const abort = () => {
    terminalError ??= fail("External command cancelled", "external_command_cancelled", false);
    terminate();
  };
  const timer = setTimeout(() => {
    terminalError ??= fail(`External command exceeded ${timeoutMs} ms`, "external_command_timeout", false);
    terminate();
  }, timeoutMs);

  child.stdout.on("data", collect("stdout"));
  child.stderr.on("data", collect("stderr"));
  child.on("error", error => finish(error));
  child.stdin.on("error", error => { if (error.code !== "EPIPE") finish(error); });
  child.on("close", code => {
    if (killTimer) { kill("SIGKILL"); clearTimeout(killTimer); }
    if (settled) return;
    if (terminalError) { finish(terminalError); return; }
    const result = { exitCode: code ?? -1, stdout: stdout.trim(), stderr: stderr.trim() };
    if (code !== 0 && rejectOnNonZero) {
      const detail = result.stderr || result.stdout || `exit code ${code}`;
      finish(fail(`External command failed: ${detail}`, "external_command_failed", false, result));
      return;
    }
    finish(null, result);
  });

  if (signal?.aborted) {
    abort();
    return;
  }
  signal?.addEventListener("abort", abort, { once: true });
  child.stdin.end(input == null ? undefined : String(input));
});
