import { createHash } from "node:crypto";

const HEARTBEAT_MS = 30_000;
const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;
const MAX_CLIENT_FRAME_BYTES = 2 * 1024 * 1024;
const MAX_CLIENT_BUFFER_BYTES = 4 * 1024 * 1024;

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

const protocolError = message => Object.assign(new Error(message), { websocketCode: 1002 });

const parseClientFrames = (buffer, onFrame) => {
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const fin = (first & 0x80) !== 0;
    const rsv = first & 0x70;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    if (!fin) throw protocolError("Fragmented WebSocket client frames are not supported");
    if (rsv) throw protocolError("Unexpected WebSocket RSV bits");
    if (!masked) throw protocolError("Client WebSocket frames must be masked");
    if (![0x1, 0x2, 0x8, 0x9, 0xA].includes(opcode)) throw protocolError(`Unsupported WebSocket opcode: ${opcode}`);

    let length = second & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (buffer.length - offset < 4) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) break;
      const largeLength = buffer.readBigUInt64BE(offset + 2);
      if (largeLength > BigInt(MAX_CLIENT_FRAME_BYTES)) throw protocolError("WebSocket client frame is too large");
      length = Number(largeLength);
      headerLength = 10;
    }
    if (length > MAX_CLIENT_FRAME_BYTES) throw protocolError("WebSocket client frame is too large");
    if ([0x8, 0x9, 0xA].includes(opcode) && length > 125) throw protocolError("WebSocket control frame is too large");

    const totalLength = headerLength + 4 + length;
    if (buffer.length - offset < totalLength) break;
    const maskOffset = offset + headerLength;
    const payloadOffset = maskOffset + 4;
    const mask = buffer.subarray(maskOffset, maskOffset + 4);
    const payload = Buffer.from(buffer.subarray(payloadOffset, payloadOffset + length));
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
    onFrame({ opcode, payload });
    offset += totalLength;
  }
  return buffer.subarray(offset);
};

const waitForDrain = socket => new Promise((resolve, reject) => {
  const done = () => {
    socket.off("error", failed);
    resolve();
  };
  const failed = error => {
    socket.off("drain", done);
    reject(error);
  };
  socket.once("drain", done);
  socket.once("error", failed);
});

const createClient = socket => {
  const client = {
    socket,
    readyState: OPEN,
    isAlive: true,
    input: Buffer.alloc(0),
    async sendText(value) {
      if (client.readyState !== OPEN || socket.destroyed) return false;
      const writable = socket.write(frame(0x1, JSON.stringify(value)));
      if (!writable) await waitForDrain(socket);
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

export const attachOfficeStateWebSocket = ({ server, allowedOrigin, service, onCommand }) => {
  if (!server) throw new Error("Office state WebSocket requires the HTTP server");
  if (!allowedOrigin || typeof allowedOrigin !== "string") throw new Error("Office state WebSocket requires one allowed frontend origin");
  if (!service) throw new Error("Office state WebSocket requires the Office state service");
  if (typeof onCommand !== "function") throw new Error("Office state WebSocket requires an app command handler");

  const clients = new Set();
  const handleUpgrade = (req, socket) => {
    let url;
    try { url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`); } catch {
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

    const requestedSince = nonNegativeInteger(url.searchParams.get("since"));
    const key = req.headers["sec-websocket-key"];
    if (
      requestedSince === null
      || req.headers.upgrade?.toLowerCase() !== "websocket"
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

    const client = createClient(socket);
    clients.add(client);
    let cleaned = false;
    let lastRevision = requestedSince;
    let clientInstance = url.searchParams.get("instance");
    let sendQueue = Promise.resolve();

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      client.readyState = CLOSED;
      clients.delete(client);
      unsubscribe();
    };

    const enqueueSend = operation => {
      const next = sendQueue.catch(() => {}).then(operation);
      sendQueue = next;
      return next;
    };

    const sendLatest = () => enqueueSend(async () => {
      if (client.readyState !== OPEN || socket.destroyed) return;
      const payload = await service.responseSince({ since: lastRevision, clientInstance });
      if (!payload.reset && !payload.changed.length) return;
      lastRevision = payload.revision;
      clientInstance = payload.instance;
      await client.sendText({ type: "state", ...payload });
    });

    const sendCommandResult = (id, result) => enqueueSend(() => client.sendText({
      type: "command-result",
      id,
      ...result,
    }));

    const handleCommand = async payload => {
      let message;
      try {
        message = JSON.parse(payload.toString("utf8"));
      } catch {
        throw protocolError("Invalid WebSocket command JSON");
      }
      if (!message || message.type !== "command" || typeof message.id !== "string" || typeof message.command !== "string") {
        throw protocolError("Invalid WebSocket command envelope");
      }

      try {
        const data = await onCommand({ command: message.command, payload: message.payload ?? {} });
        await sendCommandResult(message.id, { ok: true, data });
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
        if (statusCode >= 500) console.error("[app-command] Command failed.", { command: message.command, message: text });
        await sendCommandResult(message.id, { ok: false, error: text, statusCode });
      }
    };

    const unsubscribe = service.subscribe(() => {
      void sendLatest().catch(error => {
        console.error("[office-state] WebSocket state send failed.", { message: error instanceof Error ? error.message : String(error) });
        client.close(1011, "State synchronization failed");
      });
    });

    socket.on("data", chunk => {
      try {
        if (client.input.length + chunk.length > MAX_CLIENT_BUFFER_BYTES) throw protocolError("WebSocket client input buffer is too large");
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
          if (opcode === 0xA) {
            client.isAlive = true;
            return;
          }
          if (opcode === 0x1) {
            void handleCommand(payload).catch(error => {
              console.error("[app-command] Invalid command frame.", { message: error instanceof Error ? error.message : String(error) });
              if (error?.websocketCode) client.close(error.websocketCode, "Protocol error");
            });
          }
        });
      } catch (error) {
        console.error("[office-state] Invalid WebSocket client frame.", { message: error instanceof Error ? error.message : String(error) });
        if (client.readyState === OPEN) client.close(error.websocketCode || 1002, "Protocol error");
        else client.terminate();
      }
    });
    socket.on("error", error => {
      console.error("[office-state] WebSocket client error.", { message: error instanceof Error ? error.message : String(error) });
    });
    socket.on("close", cleanup);
    socket.on("end", cleanup);

    void sendLatest().catch(error => {
      console.error("[office-state] Initial WebSocket state send failed.", { message: error instanceof Error ? error.message : String(error) });
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
