import { applyCredential } from "../src/services/CredentialService.mjs";

const tool = {
  name: "http",
  description: "Issues HTTP requests with optional credentials injected locally by service name. Credential secrets never enter Agent or model context and may only be sent to hosts allowed by that credential profile. Google Workspace service-account credentials mint short-lived delegated OAuth tokens server-side and may only access approved Workspace API routes.",
  requiresApproval: false,
  provider: null,
  model: null,
  input: {
    type: "object",
    properties: {
      method: {
        type: "string",
        enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        description: "HTTP method. Defaults to GET.",
        default: "GET",
      },
      url: {
        type: "string",
        description: "Full URL to request.",
      },
      headers: {
        type: "object",
        description: "Optional request headers.",
        default: {},
      },
      query: {
        type: "object",
        description: "Optional query parameters.",
        default: {},
      },
      body: {
        type: ["object", "string", "number", "boolean", "null"],
        description: "Optional request body. Objects are JSON encoded.",
        default: null,
      },
      timeoutMs: {
        type: "number",
        description: "Request timeout in milliseconds. Defaults to 30000.",
        default: 30000,
      },
      responseType: {
        type: "string",
        enum: ["auto", "text", "json"],
        description: "Response parser. Defaults to auto.",
        default: "auto",
      },
      maxBytes: {
        type: "number",
        description: "Maximum response body size. Defaults to 10 MB.",
        default: 10485760,
      },
      auth: {
        type: "object",
        description: "Inject a credential by service name. Header, scheme, secret, delegated subject, scopes, and allowed hosts are controlled by Carlos Office.",
        properties: {
          service: {
            type: "string",
            description: "Credential service identifier configured on the Credentials page.",
          },
        },
        required: ["service"],
        additionalProperties: false,
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
  output: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      status: { type: "number" },
      statusText: { type: "string" },
      url: { type: "string" },
      method: { type: "string" },
      contentType: { type: "string" },
      bodyBytes: { type: "number" },
      body: { type: ["object", "array", "string", "number", "boolean", "null"] },
      headers: { type: "object" },
      allow: { type: "string" },
      corsHeaders: { type: "object" },
    },
  },
  async execute(inputs = {}) {
    const url = typeof inputs.url === "string" ? inputs.url.trim() : "";
    if (!url) throw new Error('http: "url" is required and must be a non-empty string.');

    const method = typeof inputs.method === "string" && inputs.method ? inputs.method.toUpperCase() : "GET";
    const allowed = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
    if (!allowed.includes(method)) throw new Error(`http: "method" must be one of ${allowed.join(", ")}`);

    const headers = inputs.headers && typeof inputs.headers === "object" ? inputs.headers : {};
    const query = inputs.query && typeof inputs.query === "object" ? inputs.query : {};
    const body = inputs.body ?? null;
    const timeoutMs = typeof inputs.timeoutMs === "number" ? inputs.timeoutMs : 30000;
    const responseType = inputs.responseType ?? "auto";
    const maxBytes = typeof inputs.maxBytes === "number" ? inputs.maxBytes : 10485760;

    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs must be a positive number");
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error("maxBytes must be a positive number");
    if (!["auto", "text", "json"].includes(responseType)) throw new Error("responseType must be one of: auto, text, json");

    let target;
    try {
      const parsed = new URL(url);
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) parsed.searchParams.set(key, String(value));
      }
      target = parsed.toString();
    } catch {
      throw new Error(`http: invalid URL: ${url}`);
    }

    const auth = inputs.auth && typeof inputs.auth === "object" ? inputs.auth : null;
    const baseHeaders = sanitizeHeaders(headers);
    let finalHeaders = baseHeaders;
    let sensitiveValues = [];
    if (auth) {
      if (typeof auth.service !== "string" || !auth.service.trim()) throw new Error("http: auth.service is required.");
      finalHeaders = await applyCredential({
        service: auth.service.trim(),
        url: target,
        headers: finalHeaders,
      });
      sensitiveValues = credentialValues(baseHeaders, finalHeaders);
    }

    let payload = body;
    if (body !== null && typeof body === "object" && !Array.isArray(body)) {
      payload = JSON.stringify(body);
      if (!finalHeaders["content-type"] && !finalHeaders["Content-Type"]) finalHeaders["content-type"] = "application/json";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(target, {
        method,
        headers: finalHeaders,
        body: method === "GET" || method === "OPTIONS" || payload === null || payload === undefined
          ? undefined
          : (typeof payload === "string" ? payload : String(payload)),
        // Never forward an injected credential through an automatic redirect.
        redirect: auth ? "manual" : "follow",
        signal: controller.signal,
      });

      const contentType = response.headers.get("content-type") || "";
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new Error(`http: response exceeds maxBytes limit (${declaredLength} > ${maxBytes})`);
      }

      const rawText = await response.text();
      if (Buffer.byteLength(rawText, "utf8") > maxBytes) throw new Error(`http: response body exceeds maxBytes limit (${maxBytes})`);
      const text = redact(rawText, sensitiveValues);

      const wantsJson = responseType === "json" || (responseType === "auto" && contentType.includes("application/json"));
      let responseBody = text;
      if (wantsJson) {
        try {
          responseBody = JSON.parse(text);
        } catch (parseError) {
          if (responseType === "json") throw new Error(`http: response declared JSON but could not be parsed: ${parseError.message}`);
        }
      }

      const responseHeaders = sanitizeResponseHeaders(Object.fromEntries(response.headers.entries()), sensitiveValues);
      const allow = response.headers.get("allow") || "";
      const corsHeaders = {};
      for (const [key, value] of Object.entries(responseHeaders)) {
        if (key.startsWith("access-control-")) corsHeaders[key] = value;
      }

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        method,
        contentType,
        bodyBytes: Buffer.byteLength(rawText, "utf8"),
        body: responseBody,
        headers: responseHeaders,
        allow,
        corsHeaders,
      };
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(`http: request timed out after ${timeoutMs} ms`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  },
};

function credentialValues(before, after) {
  const result = new Set();
  for (const [name, value] of Object.entries(after)) {
    const previous = Object.entries(before).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
    if (previous === value) continue;
    result.add(String(value));
    const separator = String(value).indexOf(" ");
    if (separator > 0) result.add(String(value).slice(separator + 1));
  }
  return [...result].filter(value => value.length >= 4);
}

function redact(value, sensitiveValues) {
  let result = String(value ?? "");
  for (const secret of sensitiveValues) result = result.split(secret).join("[REDACTED]");
  return result;
}

function sanitizeResponseHeaders(headers, sensitiveValues) {
  const blocked = new Set(["authorization", "cookie", "proxy-authorization", "set-cookie"]);
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    if (blocked.has(key.toLowerCase())) continue;
    result[key] = redact(value, sensitiveValues);
  }
  return result;
}

function sanitizeHeaders(headers) {
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key && value !== undefined && value !== null) result[key] = String(value);
  }
  return result;
}

export default tool;
export { tool };
