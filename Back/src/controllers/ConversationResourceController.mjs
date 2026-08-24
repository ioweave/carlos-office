const requestError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const partsFrom = pathname => pathname.split("/").filter(Boolean).map(decodeURIComponent);

const safeFilename = value => String(value || "file").replaceAll('"', "");

export const createConversationResourceController = ({
  allowedOrigin,
  nora,
  artifacts,
  attachments,
}) => {
  if (!allowedOrigin || typeof allowedOrigin !== "string") {
    throw new Error("Conversation resource controller requires one allowed frontend origin");
  }

  const readJson = async req => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (!chunks.length) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw requestError("Invalid JSON request body");
    }
  };

  const matches = req => {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const parts = partsFrom(url.pathname);
    if (parts[0] !== "conversations" || !parts[1]) return false;
    if (parts[2] === "requests" && parts.length === 3) return true;
    if (["attachments", "artifacts"].includes(parts[2]) && [3, 4].includes(parts.length)) return true;
    return false;
  };

  const handle = async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const parts = partsFrom(url.pathname);
    const method = req.method ?? "GET";
    const origin = req.headers.origin ?? null;

    if (origin && origin !== allowedOrigin) {
      res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Origin not allowed" }));
      return;
    }

    const cors = {
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    };
    const sendJson = (status, data) => {
      res.writeHead(status, { ...cors, "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(data));
    };
    const sendError = (status, message) => sendJson(status, { error: message });

    if (method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    try {
      const conversationId = parts[1];
      const resource = parts[2];
      const resourceId = parts[3] ?? null;

      if (method === "POST" && resource === "requests" && parts.length === 3) {
        const body = await readJson(req);
        const result = await nora.handleCarlosRequest({
          conversationId,
          content: body.content,
          attachments: body.attachments ?? [],
        });
        sendJson(200, result);
        return;
      }

      if (resource === "attachments" && parts.length === 3 && method === "GET") {
        sendJson(200, await attachments.listAttachments(conversationId));
        return;
      }

      if (resource === "attachments" && parts.length === 3 && method === "POST") {
        const body = await readJson(req);
        const attachment = await attachments.createAttachment({
          conversationId,
          name: body.name,
          type: body.type,
          createdBy: body.createdBy ?? "Carlos",
          content: body.encoding === "base64"
            ? Buffer.from(body.content ?? "", "base64")
            : body.content ?? "",
        });
        sendJson(201, attachment);
        return;
      }

      if (resource === "artifacts" && parts.length === 3 && method === "GET") {
        sendJson(200, await artifacts.listArtifacts(conversationId));
        return;
      }

      if (resource === "artifacts" && parts.length === 3 && method === "POST") {
        const body = await readJson(req);
        const artifact = await artifacts.createArtifact({
          conversationId,
          name: body.name,
          type: body.type,
          createdBy: body.createdBy ?? "Carlos",
          content: body.encoding === "base64"
            ? Buffer.from(body.content ?? "", "base64")
            : body.content ?? "",
        });
        sendJson(201, artifact);
        return;
      }

      if (parts.length === 4 && method === "GET" && resource === "attachments") {
        const attachment = await attachments.getAttachment(conversationId, resourceId);
        if (!attachment) {
          sendError(404, "Attachment not found");
          return;
        }
        const content = await attachments.readAttachment(conversationId, resourceId);
        const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
        res.writeHead(200, {
          ...cors,
          "Content-Type": attachment.type ?? "application/octet-stream",
          "Content-Disposition": `${disposition}; filename="${safeFilename(attachment.name)}"`,
          "Cache-Control": "no-store",
        });
        res.end(content);
        return;
      }

      if (parts.length === 4 && method === "GET" && resource === "artifacts") {
        const artifact = await artifacts.getArtifact(conversationId, resourceId);
        if (!artifact) {
          sendError(404, "Artifact not found");
          return;
        }
        const content = await artifacts.readArtifact(conversationId, resourceId);
        const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
        res.writeHead(200, {
          ...cors,
          "Content-Type": artifact.type ?? "application/octet-stream",
          "Content-Disposition": `${disposition}; filename="${safeFilename(artifact.name)}"`,
          "Cache-Control": "no-store",
        });
        res.end(content);
        return;
      }

      sendError(404, "Route not found");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      sendError(status, message);
    }
  };

  return { matches, handle };
};
