import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir, userInfo } from "node:os";
import { resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";

const MAX_INPUT_BYTES = 128 * 1024;
const TERMINATE_GRACE_MS = 1_500;

const commandError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const normalizeOrigin = value => {
  try { return new URL(value).origin; } catch { return ""; }
};
const hostnameFromHost = value => {
  try { return new URL(`http://${value}`).hostname; } catch { return ""; }
};

export const createTerminalController = ({ allowedOrigin }) => {
  const sessions = new Map();
  const sessionByConnection = new Map();
  const registeredConnections = new Set();
  const trustedOrigin = normalizeOrigin(allowedOrigin);

  const assertTrustedClient = context => {
    const origin = normalizeOrigin(context?.origin);
    const originHostname = origin ? new URL(origin).hostname : "";
    const requestHostname = hostnameFromHost(context?.host);
    if (!origin || (origin !== trustedOrigin && (!originHostname || originHostname !== requestHostname))) {
      throw commandError("Server Terminal is available only from the Carlos Office frontend on this server.", 403);
    }
  };

  const metadata = session => ({
    sessionId: session.id,
    status: session.exited ? "exited" : "open",
    shell: session.shell,
    cwd: session.cwd,
    username: session.username,
    pid: session.child.pid ?? null,
  });

  const unregister = session => {
    sessions.delete(session.id);
    if (sessionByConnection.get(session.connectionId) === session.id) sessionByConnection.delete(session.connectionId);
  };

  const terminate = session => {
    if (!session || session.exited) return;
    session.child.kill("SIGTERM");
    const timer = setTimeout(() => {
      if (!session.exited) session.child.kill("SIGKILL");
    }, TERMINATE_GRACE_MS);
    timer.unref?.();
  };

  const closeConnectionSession = connectionId => {
    const session = sessions.get(sessionByConnection.get(connectionId));
    if (session) terminate(session);
    sessionByConnection.delete(connectionId);
    registeredConnections.delete(connectionId);
  };

  const registerConnectionCleanup = context => {
    if (registeredConnections.has(context.connectionId)) return;
    registeredConnections.add(context.connectionId);
    context.onClose(() => closeConnectionSession(context.connectionId));
  };

  const open = async (payload, context) => {
    assertTrustedClient(context);
    registerConnectionCleanup(context);

    const current = sessions.get(sessionByConnection.get(context.connectionId));
    if (current && !current.exited) return metadata(current);

    const cwd = resolve(String(payload.cwd || homedir()));
    const shell = process.env.SHELL || "/bin/bash";
    const username = userInfo().username;
    const child = spawn("script", ["-qefc", `${shell} -l`, "/dev/null"], {
      cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const session = {
      id: `terminal-${randomUUID()}`,
      connectionId: context.connectionId,
      child,
      shell,
      cwd,
      username,
      exited: false,
    };
    const stdout = new StringDecoder("utf8");
    const stderr = new StringDecoder("utf8");

    const sendOutput = data => {
      if (!data) return;
      void context.send({ type: "terminal.output", sessionId: session.id, data }).catch(() => {});
    };
    child.stdout.on("data", chunk => sendOutput(stdout.write(chunk)));
    child.stderr.on("data", chunk => sendOutput(stderr.write(chunk)));
    child.on("exit", (code, signal) => {
      if (session.exited) return;
      session.exited = true;
      sendOutput(stdout.end());
      sendOutput(stderr.end());
      unregister(session);
      void context.send({
        type: "terminal.exit",
        sessionId: session.id,
        code: Number.isInteger(code) ? code : null,
        signal: signal || null,
      }).catch(() => {});
    });

    await new Promise((resolveSpawn, rejectSpawn) => {
      const handleSpawn = () => {
        child.off("error", handleError);
        resolveSpawn();
      };
      const handleError = error => {
        child.off("spawn", handleSpawn);
        rejectSpawn(error);
      };
      child.once("spawn", handleSpawn);
      child.once("error", handleError);
    }).catch(error => {
      session.exited = true;
      unregister(session);
      throw commandError(`Could not start server shell: ${error instanceof Error ? error.message : String(error)}`, 500);
    });

    sessions.set(session.id, session);
    sessionByConnection.set(context.connectionId, session.id);
    return metadata(session);
  };

  const input = async (payload, context) => {
    assertTrustedClient(context);
    const session = sessions.get(payload.sessionId);
    if (!session || session.connectionId !== context.connectionId || session.exited) {
      throw commandError("Terminal session is not active.", 404);
    }
    const data = typeof payload.data === "string" ? payload.data : "";
    if (!data) return { written: 0 };
    if (Buffer.byteLength(data, "utf8") > MAX_INPUT_BYTES) throw commandError("Terminal input is too large.", 413);
    if (!session.child.stdin.writable) throw commandError("Terminal input is closed.", 409);

    await new Promise((resolveWrite, rejectWrite) => {
      session.child.stdin.write(data, "utf8", error => error ? rejectWrite(error) : resolveWrite());
    });
    return { written: Buffer.byteLength(data, "utf8") };
  };

  const close = async (payload, context) => {
    assertTrustedClient(context);
    const session = sessions.get(payload.sessionId);
    if (!session || session.connectionId !== context.connectionId) return { closed: false };
    terminate(session);
    return { closed: true };
  };

  const dispose = () => {
    for (const session of sessions.values()) terminate(session);
    sessions.clear();
    sessionByConnection.clear();
    registeredConnections.clear();
  };

  return { open, input, close, dispose };
};
