import { createOfficeStateService } from "../services/OfficeStateService.mjs";

const MAX_PING_WAIT_MS = 240_000;

const requestError = message => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

export const createOfficeStateController = ({ allowedOrigin, noraRegistry, nora, service = null, ...dependencies }) => {
  if (!allowedOrigin || typeof allowedOrigin !== "string") {
    throw new Error("Office State controller requires one allowed frontend origin");
  }

  const stateService = service ?? createOfficeStateService({ nora, ...dependencies });
  const urlFrom = req => new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const matches = req => {
    const pathname = urlFrom(req).pathname;
    return pathname === "/ping" || (pathname === "/nora" && req.method === "PATCH");
  };

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

  const validateNoraSelection = ({ provider, model }) => {
    if (typeof provider !== "string" || !provider.trim()) throw requestError("Nora provider is required");
    if (typeof model !== "string" || !model.trim()) throw requestError("Nora model is required");

    const selectedProvider = provider.trim();
    const selectedModel = model.trim();
    const providerEntry = nora.listModels().find(item => item.provider === selectedProvider);
    if (!providerEntry || !providerEntry.models?.includes(selectedModel)) {
      throw requestError(`Unknown model selection: ${selectedProvider}/${selectedModel}`);
    }
    return { provider: selectedProvider, model: selectedModel };
  };

  const handle = async (req, res) => {
    const origin = req.headers.origin ?? null;
    const cors = {
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,PATCH,OPTIONS",
      ...(origin === allowedOrigin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    };
    const sendJson = (status, data) => {
      if (res.writableEnded || res.destroyed) return;
      res.writeHead(status, {
        ...cors,
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(data));
    };

    if (origin && origin !== allowedOrigin) return sendJson(403, { error: "Origin not allowed" });

    try {
      const url = urlFrom(req);

      if (url.pathname === "/nora") {
        const selection = validateNoraSelection(await readJson(req));
        await noraRegistry.saveNoraDefinition(selection);
        await stateService.invalidate(["nora", "models"]);
        return sendJson(200, nora.getNoraState());
      }

      if (req.method !== "GET") return sendJson(405, { error: "Method not allowed" });

      const rawSince = url.searchParams.get("since");
      const rawWait = url.searchParams.get("wait");
      if (rawSince !== null && !/^\d+$/.test(rawSince)) {
        throw requestError("Ping revision must be a non-negative integer");
      }
      if (rawWait !== null && !/^\d+$/.test(rawWait)) {
        throw requestError("Ping wait must be a non-negative integer");
      }

      const since = rawSince === null ? 0 : Number(rawSince);
      const waitMs = rawWait === null ? 0 : Number(rawWait);
      if (!Number.isSafeInteger(since)) throw requestError("Ping revision is outside the supported range");
      if (!Number.isSafeInteger(waitMs) || waitMs > MAX_PING_WAIT_MS) {
        throw requestError(`Ping wait must be between 0 and ${MAX_PING_WAIT_MS} milliseconds`);
      }

      const controller = new AbortController();
      const handleClose = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.once("close", handleClose);

      try {
        const payload = await stateService.ping({
          since,
          waitMs,
          clientInstance: url.searchParams.get("instance"),
          signal: controller.signal,
        });
        if (!payload) return;
        return sendJson(200, payload);
      } finally {
        res.off("close", handleClose);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      if (status >= 500) console.error("[office-state] Request failed.", { message });
      return sendJson(status, { error: message });
    }
  };

  return { matches, handle, service: stateService };
};
