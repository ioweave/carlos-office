import {
  deleteVariable,
  getVariable,
  listVariables,
  setVariable,
} from "../services/VariableService.mjs";

const requestError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const partsFrom = pathname => pathname.split("/").filter(Boolean).map(decodeURIComponent);

export const createVariableController = ({ allowedOrigin }) => {
  if (!allowedOrigin || typeof allowedOrigin !== "string") {
    throw new Error("VariableController requires one allowed frontend origin");
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
      return pathname === "/variables" || pathname.startsWith("/variables/");
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
        res.writeHead(status, {
          ...cors,
          "Cache-Control": "no-store",
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify(data));
      };

      if (method === "OPTIONS") {
        res.writeHead(204, cors);
        res.end();
        return;
      }

      try {
        if (parts[0] !== "variables") throw requestError("Not found", 404);

        if (method === "GET" && parts.length === 1) {
          return sendJson(200, listVariables());
        }

        if (method === "GET" && parts.length === 2) {
          const variable = getVariable(parts[1]);
          return variable ? sendJson(200, variable) : sendJson(404, { error: "Variable not found" });
        }

        if (method === "PUT" && parts.length === 2) {
          const current = getVariable(parts[1]);
          const body = await readJson(req);
          if (typeof body.value !== "string") throw requestError("Variable value must be a string");
          const variable = setVariable({
            key: parts[1],
            value: body.value,
            description: body.description ?? "",
          });
          return sendJson(current ? 200 : 201, variable);
        }

        if (method === "DELETE" && parts.length === 2) {
          const result = deleteVariable(parts[1]);
          return result.deleted
            ? sendJson(200, result)
            : sendJson(404, { error: "Variable not found" });
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
