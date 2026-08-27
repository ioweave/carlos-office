import {
  deleteCredential,
  getCredential,
  listCredentials,
  setCredential,
} from "../services/CredentialService.mjs";

const requestError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const partsFrom = pathname => pathname.split("/").filter(Boolean).map(decodeURIComponent);

export const createCredentialController = ({ allowedOrigin, onConfigurationChanged = async () => {} }) => {
  if (!allowedOrigin || typeof allowedOrigin !== "string") {
    throw new Error("CredentialController requires one allowed frontend origin");
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

  const corsFor = origin => ({
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,PUT,DELETE,OPTIONS",
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
  });

  return {
    matches(req) {
      const pathname = new URL(req.url, `http://${req.headers.host ?? "localhost"}`).pathname;
      return pathname === "/credentials" || pathname.startsWith("/credentials/");
    },

    async handle(req, res) {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      const parts = partsFrom(url.pathname);
      const method = req.method ?? "GET";
      const origin = req.headers.origin ?? null;

      if (origin && origin !== allowedOrigin) {
        res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Origin not allowed" }));
        return;
      }

      const cors = corsFor(origin);
      const sendJson = (status, data) => {
        res.writeHead(status, { ...cors, "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(data));
      };

      if (method === "OPTIONS") {
        res.writeHead(204, cors);
        res.end();
        return;
      }

      try {
        if (parts[0] !== "credentials") throw requestError("Not found", 404);

        if (method === "GET" && parts.length === 1) {
          return sendJson(200, listCredentials());
        }

        if (method === "GET" && parts.length === 2) {
          const credential = getCredential(parts[1]);
          return credential ? sendJson(200, credential) : sendJson(404, { error: "Credential not found" });
        }

        if (method === "PUT" && parts.length === 2) {
          const current = getCredential(parts[1]);
          const body = await readJson(req);
          const credential = setCredential({
            service: parts[1],
            secret: body.secret ?? null,
            type: body.type ?? null,
            allowedHosts: body.allowedHosts ?? null,
            headerName: body.headerName ?? null,
            scheme: body.scheme ?? null,
            subject: body.subject ?? null,
            scopes: body.scopes ?? null,
          });
          await onConfigurationChanged();
          return sendJson(current ? 200 : 201, credential);
        }

        if (method === "DELETE" && parts.length === 2) {
          const result = deleteCredential(parts[1]);
          if (result.deleted) await onConfigurationChanged();
          return result.deleted
            ? sendJson(200, result)
            : sendJson(404, { error: "Credential not found" });
        }

        return sendJson(404, { error: "Not found" });
      } catch (error) {
        return sendJson(error.statusCode ?? 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
};
