import { getKnowledge, saveKnowledge } from "../services/KnowledgeService.mjs";

const requestError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

export const createKnowledgeController = ({ allowedOrigin }) => {
  if (!allowedOrigin || typeof allowedOrigin !== "string") {
    throw new Error("KnowledgeController requires one allowed frontend origin");
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
    "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
  });

  return {
    matches(req) {
      const pathname = new URL(req.url, `http://${req.headers.host ?? "localhost"}`).pathname;
      return pathname === "/knowledge";
    },

    async handle(req, res) {
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
        if (method === "GET") return sendJson(200, getKnowledge());

        if (method === "PUT") {
          const body = await readJson(req);
          if (typeof body.facts !== "string") throw requestError("Knowledge facts must be a string");
          if (typeof body.instructions !== "string") {
            throw requestError("Knowledge instructions must be a string");
          }
          return sendJson(200, await saveKnowledge({ facts: body.facts, instructions: body.instructions }));
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
