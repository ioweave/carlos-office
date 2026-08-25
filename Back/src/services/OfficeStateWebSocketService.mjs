import { WebSocket, WebSocketServer } from "ws";

const HEARTBEAT_MS = 30_000;

const nonNegativeInteger = value => {
  if (value == null || value === "") return 0;
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
};

export const attachOfficeStateWebSocket = ({ server, allowedOrigin, service }) => {
  if (!server) throw new Error("Office state WebSocket requires the HTTP server");
  if (!allowedOrigin || typeof allowedOrigin !== "string") {
    throw new Error("Office state WebSocket requires one allowed frontend origin");
  }
  if (!service) throw new Error("Office state WebSocket requires the Office state service");

  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  const handleUpgrade = (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    } catch {
      socket.destroy();
      return;
    }

    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    if (req.headers.origin && req.headers.origin !== allowedOrigin) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, ws => {
      wss.emit("connection", ws, req, url);
    });
  };

  server.on("upgrade", handleUpgrade);

  wss.on("connection", (ws, _req, url) => {
    const requestedSince = nonNegativeInteger(url.searchParams.get("since"));
    if (requestedSince === null) {
      ws.close(1008, "Invalid state revision");
      return;
    }

    let lastRevision = requestedSince;
    let clientInstance = url.searchParams.get("instance");
    let sendQueue = Promise.resolve();
    ws.isAlive = true;

    const sendLatest = () => {
      const next = sendQueue.catch(() => {}).then(async () => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const payload = await service.responseSince({
          since: lastRevision,
          clientInstance,
        });
        if (!payload.reset && !payload.changed.length) return;
        lastRevision = payload.revision;
        clientInstance = payload.instance;
        ws.send(JSON.stringify({ type: "state", ...payload }));
      });
      sendQueue = next;
      return next;
    };

    const unsubscribe = service.subscribe(() => {
      void sendLatest().catch(error => {
        console.error("[office-state] WebSocket state send failed.", {
          message: error instanceof Error ? error.message : String(error),
        });
      });
    });

    ws.on("pong", () => {
      ws.isAlive = true;
    });
    ws.on("error", error => {
      console.error("[office-state] WebSocket client error.", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
    ws.on("close", unsubscribe);

    void sendLatest().catch(error => {
      console.error("[office-state] Initial WebSocket state send failed.", {
        message: error instanceof Error ? error.message : String(error),
      });
      ws.close(1011, "State synchronization failed");
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  const close = () => {
    clearInterval(heartbeat);
    server.off("upgrade", handleUpgrade);
    for (const ws of wss.clients) ws.close(1001, "Carlos Office shutting down");
    wss.close();
  };

  return { close };
};
