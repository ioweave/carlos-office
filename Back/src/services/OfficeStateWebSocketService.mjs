import { createHash } from "node:crypto";

const HEARTBEAT_MS = 30_000;
const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

const nonNegativeInteger = value => {
  if (value == null || value === "") return 0;
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
};

const frame = (opcode, payload = Buffer.alloc(0)) => {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), "utf8");
  let header;

  if (body.length < 126) {
    header = Buffer.from([0x80 | opcode, body.length]);
  } else if (body.length <= 0xffff) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }

  return Buffer.concat([header, body]);
};

const parseClientFrames = (buffer, onFrame) => {
  let offset = 0;

  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let headerLength = 2;

    if (length === 126) {
      if (buffer.length - offset < 4) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) break;
      const largeLength = buffer.readBigUInt64BE(offset + 2);
      if (largeLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("WebSocket frame is too large");
      length = Number(largeLength);
      headerLength = 10;
    }

    const maskLength = masked ? 4 : 0;
    const totalLength = headerLength + maskLength + length;
    if (buffer.length - offset < totalLength) break;

    const maskOffset = offset + headerLength;
    const payloadOffset = maskOffset + maskLength;
    const payload = Buffer.from(buffer.subarray(payloadOffset, payloadOffset + length));

    if (masked) {
      const mask = buffer.subarray(maskOffset, maskOffset + 4);
      for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
    }

    onFrame({ opcode, payload });
    offset += totalLength;
  }

  return buffer.subarray(offset);
};

const createClient = socket => {
  const client = {
    socket,
    readyState: OPEN,
    isAlive: true,
    input: Buffer.alloc(0),
    sendText(value) {
      if (client.readyState !== OPEN || socket.destroyed) return false;
      socket.write(frame(0x1, JSON.stringify(value)));
      return true;
    },
    ping() {
      if (client.readyState === OPEN && !socket.destroyed) socket.write(frame(0x9));
    },
    close(code = 1000, reason = "") {
      if (client.readyState !== OPEN || socket.destroyed) return;
      client.readyState = CLOSING;
      const reasonBytes = Buffer.from(reason, "utf8").subarray(0, 123);
      const payload = Buffer.allocUnsafe(2 + reasonBytes.length);
      payload.writeUInt16BE(code, 0);
      reasonBytes.copy(payload, 2);
      socket.end(frame(0x8, payload));
    },
    terminate() {
      client.readyState = CLOSED;
      socket.destroy();
    },
  };
  return client;
};

export const attachOfficeStateWebSocket = ({ server, allowedOrigin, service }) => {
  if (!server) throw new Error("Office state WebSocket requires the HTTP server");
  if (!allowedOrigin || typeof allowedOrigin !== "string") {
    throw new Error("Office state WebSocket requires one allowed frontend origin");
  }
  if (!service) throw new Error("Office state WebSocket requires the Office state service");

  const clients = new Set();

  const handleUpgrade = (req, socket) => {
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

    const key = req.headers["sec-websocket-key"];
    if (
      req.headers.upgrade?.toLowerCase() !== "websocket"
      || req.headers["sec-websocket-version"] !== "13"
      || typeof key !== "string"
      || !key.trim()
    ) {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    const accept = createHash("sha1").update(`${key}${WEBSOCKET_GUID}`).digest("base64");
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n",
    ].join("\r\n"));

    const requestedSince = nonNegativeInteger(url.searchParams.get("since"));
    if (requestedSince === null) {
      socket.end(frame(0x8, Buffer.from([0x03, 0xf0])));
      return;
    }

    const client = createClient(socket);
    clients.add(client);
    let lastRevision = requestedSince;
    let clientInstance = url.searchParams.get("instance");
    let sendQueue = Promise.resolve();

    const cleanup = () => {
      client.readyState = CLOSED;
      clients.delete(client);
      unsubscribe();
    };

    const sendLatest = () => {
      const next = sendQueue.catch(() => {}).then(async () => {
        if (client.readyState !== OPEN || socket.destroyed) return;
        const payload = await service.responseSince({
          since: lastRevision,
          clientInstance,
        });
        if (!payload.reset && !payload.changed.length) return;
        lastRevision = payload.revision;
        clientInstance = payload.instance;
        client.sendText({ type: "state", ...payload });
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

    socket.on("data", chunk => {
      try {
        client.input = Buffer.concat([client.input, chunk]);
        client.input = parseClientFrames(client.input, ({ opcode, payload }) => {
          if (opcode === 0x8) {
            if (client.readyState === OPEN) socket.end(frame(0x8, payload));
            return;
          }
          if (opcode === 0x9 && client.readyState === OPEN) {
            socket.write(frame(0xA, payload));
            return;
          }
          if (opcode === 0xA) client.isAlive = true;
        });
      } catch (error) {
        console.error("[office-state] Invalid WebSocket client frame.", {
          message: error instanceof Error ? error.message : String(error),
        });
        client.terminate();
      }
    });
    socket.on("error", error => {
      console.error("[office-state] WebSocket client error.", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
    socket.on("close", cleanup);
    socket.on("end", cleanup);

    void sendLatest().catch(error => {
      console.error("[office-state] Initial WebSocket state send failed.", {
        message: error instanceof Error ? error.message : String(error),
      });
      client.close(1011, "State synchronization failed");
    });
  };

  server.on("upgrade", handleUpgrade);

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  const close = () => {
    clearInterval(heartbeat);
    server.off("upgrade", handleUpgrade);
    for (const client of clients) client.close(1001, "Carlos Office shutting down");
    clients.clear();
  };

  return { close };
};
