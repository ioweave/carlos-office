const partsFrom = pathname => pathname.split("/").filter(Boolean).map(decodeURIComponent);

export const createProviderResourceController = ({ allowedOrigin, providers }) => {
  if (!allowedOrigin || typeof allowedOrigin !== "string") throw new Error("Provider controller requires an allowed origin");
  if (!providers) throw new Error("Provider controller requires provider catalog access");

  const matches = req => {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    return url.pathname === "/providers" || url.pathname.startsWith("/providers/");
  };

  const handle = async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const parts = partsFrom(url.pathname);
    const method = req.method ?? "GET";
    const origin = req.headers.origin ?? null;
    const cors = {
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,PATCH,OPTIONS",
      ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    };

    const sendJson = (status, data) => {
      res.writeHead(status, { ...cors, "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(data));
    };

    if (origin && origin !== allowedOrigin) return sendJson(403, { error: "Origin not allowed" });
    if (method === "OPTIONS") {
      res.writeHead(204, cors);
      return res.end();
    }

    try {
      if (method === "GET" && parts.length === 1 && parts[0] === "providers") {
        return sendJson(200, await providers.listProviders({ refresh: url.searchParams.get("refresh") === "1" }));
      }

      if (
        method === "PATCH"
        && parts.length === 4
        && parts[0] === "providers"
        && parts[2] === "models"
      ) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        let body = {};
        if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const updated = await providers.updateModelPreferences(parts[1], parts[3], body);
        return sendJson(200, updated);
      }

      return sendJson(404, { error: "Provider route not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return sendJson(400, { error: message });
    }
  };

  return { matches, handle };
};
