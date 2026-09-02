import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { applyCredential } from "../src/services/CredentialService.mjs";
import { parseHttpDocument } from "../src/services/DocumentParserService.mjs";
import { resolveWorkspacePath } from "../src/services/ExecutionWorkspaceService.mjs";

const MAX_RESPONSE_BYTES = 500_000_000;
const INLINE_RESPONSE_BYTES = 1_000_000;
const TEXT_SAMPLE_BYTES = 8_192;
const here = dirname(fileURLToPath(import.meta.url));
const contentDir = resolve(here, "../.runtime/http-content");

const httpError = (message, code, { retryable = false, hint = null } = {}) => {
  const error = new Error(`http: ${message}`);
  error.code = code;
  error.retryable = retryable;
  error.hint = hint;
  return error;
};

const readCompleteBody = async response => {
  const declaredHeader = response.headers.get("content-length");
  const declaredLength = declaredHeader == null ? null : Number(declaredHeader);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw httpError(
      `response exceeds the 500 MB body limit (${declaredLength} > ${MAX_RESPONSE_BYTES} bytes)`,
      "http_response_too_large",
      {
        retryable: true,
        hint: "Request a narrower resource, use query parameters or a Range request, or use another retrieval strategy. Carlos Office will not load one HTTP response larger than 500 MB.",
      },
    );
  }

  if (!response.body) return Buffer.alloc(0);

  const chunks = [];
  let bodyBytes = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bodyBytes += buffer.length;
    if (bodyBytes > MAX_RESPONSE_BYTES) {
      throw httpError(
        `response body exceeds the 500 MB body limit (${MAX_RESPONSE_BYTES} bytes)`,
        "http_response_too_large",
        {
          retryable: true,
          hint: "Request a narrower resource, use query parameters or a Range request, or use another retrieval strategy. Carlos Office will not load one HTTP response larger than 500 MB.",
        },
      );
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks, bodyBytes);
};

const storeLargeBody = async (text, bodyBytes, metadata = {}) => {
  await mkdir(contentDir, { recursive: true });
  const id = `http-content-${randomUUID()}`;
  await writeFile(resolve(contentDir, id), text, "utf8");
  return {
    id,
    bodyBytes,
    storedBytes: Buffer.byteLength(text, "utf8"),
    ...metadata,
    instruction: "The complete readable response is stored locally. Use the http-content Tool to stat, search, or read byte ranges; do not request the whole body into model context at once.",
  };
};

const preserveBinaryBody = async (body, context, extension = ".bin") => {
  if (!context?.workspaceDir) return null;
  const relativePath = `http-downloads/http-${randomUUID()}${extension}`;
  const path = resolveWorkspacePath(context.workspaceDir, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
  return relativePath;
};

const textualContentType = contentType => {
  const value = String(contentType || "").toLowerCase();
  return value.startsWith("text/")
    || value.includes("json")
    || value.includes("xml")
    || value.includes("javascript")
    || value.includes("x-www-form-urlencoded")
    || value.includes("svg+xml");
};

const likelyTextBody = (body, contentType) => {
  if (!body.length || textualContentType(contentType)) return true;
  const sample = body.subarray(0, Math.min(TEXT_SAMPLE_BYTES, body.length));
  if (sample.includes(0)) return false;
  const text = sample.toString("utf8");
  const replacements = [...text].filter(character => character === "\uFFFD").length;
  return replacements <= Math.max(2, Math.floor(text.length * 0.01));
};

const responseBase = ({ response, method, contentType, rawBody, responseHeaders, allow, corsHeaders }) => ({
  ok: true,
  httpOk: response.ok,
  status: response.status,
  statusText: response.statusText,
  url: response.url,
  method,
  contentType,
  bodyBytes: rawBody.length,
  headers: responseHeaders,
  allow,
  corsHeaders,
});

const tool = {
  name: "http",
  description: "Issues HTTP requests with optional credentials injected locally by service name. Any received HTTP response, including 4xx and 5xx, is a successful Tool observation: ok reports transport/tool success while httpOk reports the remote HTTP success flag and status/statusText preserve the actual response. PDFs are detected by MIME type or file signature and automatically converted to readable text with the local document parser; scanned/image-only PDFs are preserved in the Agent workspace with an OCR hint instead of being decoded as UTF-8 garbage. Large readable bodies are preserved through http-content handles. Credential secrets never enter Agent or model context and may only be sent to hosts allowed by that credential profile.",
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
        description: "Response parser hint. Defaults to auto. Invalid JSON is returned as text with parseError rather than failing the Tool. PDFs are auto-detected and parsed independently of this setting.",
        default: "auto",
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
      httpOk: { type: "boolean" },
      status: { type: "number" },
      statusText: { type: "string" },
      url: { type: "string" },
      method: { type: "string" },
      contentType: { type: "string" },
      bodyBytes: { type: "number" },
      body: { type: ["object", "array", "string", "number", "boolean", "null"] },
      content: { type: ["object", "null"] },
      document: { type: ["object", "null"] },
      binary: { type: ["object", "null"] },
      parseError: { type: ["object", "null"] },
      headers: { type: "object" },
      allow: { type: "string" },
      corsHeaders: { type: "object" },
    },
  },
  async execute(inputs = {}, context = {}) {
    const url = typeof inputs.url === "string" ? inputs.url.trim() : "";
    if (!url) throw httpError('"url" is required and must be a non-empty string.', "http_invalid_url");

    const method = typeof inputs.method === "string" && inputs.method ? inputs.method.toUpperCase() : "GET";
    const allowed = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
    if (!allowed.includes(method)) throw httpError(`"method" must be one of ${allowed.join(", ")}`, "http_invalid_method");

    const headers = inputs.headers && typeof inputs.headers === "object" ? inputs.headers : {};
    const query = inputs.query && typeof inputs.query === "object" ? inputs.query : {};
    const body = inputs.body ?? null;
    const timeoutMs = typeof inputs.timeoutMs === "number" ? inputs.timeoutMs : 30000;
    const responseType = inputs.responseType ?? "auto";

    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw httpError("timeoutMs must be a positive number", "http_invalid_timeout");
    if (!["auto", "text", "json"].includes(responseType)) throw httpError("responseType must be one of: auto, text, json", "http_invalid_response_type");

    let target;
    try {
      const parsed = new URL(url);
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) parsed.searchParams.set(key, String(value));
      }
      target = parsed.toString();
    } catch {
      throw httpError(`invalid URL: ${url}`, "http_invalid_url");
    }

    const auth = inputs.auth && typeof inputs.auth === "object" ? inputs.auth : null;
    const baseHeaders = sanitizeHeaders(headers);
    let finalHeaders = baseHeaders;
    let sensitiveValues = [];
    if (auth) {
      if (typeof auth.service !== "string" || !auth.service.trim()) throw httpError("auth.service is required.", "http_invalid_auth");
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
      const rawBody = await readCompleteBody(response);
      const responseHeaders = sanitizeResponseHeaders(Object.fromEntries(response.headers.entries()), sensitiveValues);
      const allow = response.headers.get("allow") || "";
      const corsHeaders = {};
      for (const [key, value] of Object.entries(responseHeaders)) {
        if (key.startsWith("access-control-")) corsHeaders[key] = value;
      }
      const base = responseBase({ response, method, contentType, rawBody, responseHeaders, allow, corsHeaders });

      const parsedDocument = await parseHttpDocument({
        body: rawBody,
        contentType,
        signal: context.signal ?? null,
      });
      if (parsedDocument.detected) {
        const { text: documentText, ...document } = parsedDocument;
        if (parsedDocument.parsed) {
          const text = redact(documentText, sensitiveValues);
          if (Buffer.byteLength(text, "utf8") > INLINE_RESPONSE_BYTES) {
            const content = await storeLargeBody(text, rawBody.length, {
              contentType: "text/plain; charset=utf-8",
              sourceContentType: contentType,
              sourceUrl: response.url,
              parser: parsedDocument.parser,
            });
            return { ...base, body: null, content, document, binary: null, parseError: null };
          }
          return { ...base, body: text, content: null, document, binary: null, parseError: null };
        }

        const source = await preserveBinaryBody(rawBody, context, ".pdf");
        return {
          ...base,
          body: null,
          content: null,
          document: {
            ...document,
            source,
            instruction: source
              ? `The PDF is preserved at ${source}. Use Unlimited OCR when available if text extraction is required.`
              : document.hint,
          },
          binary: { preserved: Boolean(source), source, type: "pdf" },
          parseError: null,
        };
      }

      if (!likelyTextBody(rawBody, contentType)) {
        const source = await preserveBinaryBody(rawBody, context);
        return {
          ...base,
          body: null,
          content: null,
          document: null,
          binary: {
            preserved: Boolean(source),
            source,
            type: contentType || "application/octet-stream",
            instruction: "The endpoint returned binary content, so Carlos Office preserved it instead of corrupting it with UTF-8 decoding.",
          },
          parseError: null,
        };
      }

      const rawText = rawBody.toString("utf8");
      const text = redact(rawText, sensitiveValues);
      if (rawBody.length > INLINE_RESPONSE_BYTES) {
        const content = await storeLargeBody(text, rawBody.length, {
          contentType,
          sourceUrl: response.url,
        });
        return { ...base, body: null, content, document: null, binary: null, parseError: null };
      }

      const wantsJson = responseType === "json" || (responseType === "auto" && contentType.includes("application/json"));
      let responseBody = text;
      let parseError = null;
      if (wantsJson) {
        try {
          responseBody = JSON.parse(text);
        } catch (error) {
          parseError = {
            code: "http_invalid_json_response",
            message: `Response could not be parsed as JSON: ${error.message}`,
            hint: "Treat body as text or change endpoint/responseType. The HTTP observation itself succeeded.",
          };
        }
      }

      return { ...base, body: responseBody, content: null, document: null, binary: null, parseError };
    } catch (error) {
      if (error?.name === "AbortError") {
        throw httpError(
          `request timed out after ${timeoutMs} ms`,
          "http_timeout",
          { retryable: true, hint: "Retry with a larger timeoutMs or use a narrower request." },
        );
      }
      if (error instanceof TypeError && error.message === "fetch failed") {
        const causeCode = typeof error.cause?.code === "string" ? ` (${error.cause.code})` : "";
        throw httpError(
          `could not connect to ${target}${causeCode}`,
          "http_network_error",
          {
            retryable: false,
            hint: "The endpoint is unreachable from Carlos Office. Change the host or port, or inspect local listeners and processes with a system/command Tool instead of repeating the same request.",
          },
        );
      }
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
