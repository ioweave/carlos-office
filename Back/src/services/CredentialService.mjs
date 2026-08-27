import { createSign } from "node:crypto";
import { resolve } from "node:path";

import {
  DATABASE_PATH,
  ensureCredentialSchema,
  withDatabase,
} from "./DatabaseService.mjs";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_WORKSPACE_TYPE = "google-workspace";
const AUTH_TYPES = new Set(["bearer", "api-key", "basic", "custom", GOOGLE_WORKSPACE_TYPE]);

export const GOOGLE_WORKSPACE_HOSTS = Object.freeze([
  "gmail.googleapis.com",
  "www.googleapis.com",
  "docs.googleapis.com",
  "sheets.googleapis.com",
  "slides.googleapis.com",
  "chat.googleapis.com",
  "keep.googleapis.com",
  "meet.googleapis.com",
]);

export const GOOGLE_WORKSPACE_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/keep",
  "https://www.googleapis.com/auth/chat.spaces",
  "https://www.googleapis.com/auth/chat.messages",
  "https://www.googleapis.com/auth/chat.memberships",
  "https://www.googleapis.com/auth/meetings.space.settings",
  "https://www.googleapis.com/auth/meetings.space.created",
  "https://www.googleapis.com/auth/meetings.space.readonly",
]);

const GOOGLE_WORKSPACE_SCOPE_SET = new Set(GOOGLE_WORKSPACE_SCOPES);

const clean = value => typeof value === "string" ? value.trim() : "";

const normalizeHost = value => {
  const input = clean(value).toLowerCase();
  if (!input) throw new Error("Credential allowed hosts must be non-empty strings");

  const wildcard = input.startsWith("*.");
  const host = wildcard ? input.slice(2) : input;
  if (!host || /[/:\s]/.test(host)) {
    throw new Error(`Invalid credential host: ${value}`);
  }

  let normalized;
  try {
    normalized = new URL(`https://${host}`).hostname.toLowerCase();
  } catch {
    throw new Error(`Invalid credential host: ${value}`);
  }

  if (!normalized || normalized !== host) throw new Error(`Invalid credential host: ${value}`);
  return wildcard ? `*.${normalized}` : normalized;
};

const normalizeHosts = value => {
  if (!Array.isArray(value)) throw new Error("Credential allowedHosts must be an array");
  return [...new Set(value.map(normalizeHost))];
};

const parseJsonArray = value => {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const parseHosts = value => parseJsonArray(value).filter(item => typeof item === "string");

const authDefaults = type => {
  if (type === "bearer" || type === GOOGLE_WORKSPACE_TYPE) {
    return { headerName: "Authorization", scheme: "Bearer" };
  }
  if (type === "basic") return { headerName: "Authorization", scheme: "Basic" };
  if (type === "api-key") return { headerName: "X-API-Key", scheme: "" };
  return { headerName: "Authorization", scheme: "" };
};

const normalizeType = value => {
  const type = clean(value) || "bearer";
  if (!AUTH_TYPES.has(type)) throw new Error(`Unknown credential type: ${type}`);
  return type;
};

const normalizeSubject = value => {
  const subject = clean(value);
  if (!subject || !/^[^@\s]+@[^@\s]+$/.test(subject)) {
    throw new Error("Google Workspace subject must be a valid Workspace user email");
  }
  return subject;
};

const normalizeScopes = value => {
  if (!Array.isArray(value)) throw new Error("Credential scopes must be an array");
  return [...new Set(value.map(scope => clean(scope)).filter(Boolean))];
};

const normalizeGoogleScopes = value => {
  const scopes = normalizeScopes(value);
  if (!scopes.length) throw new Error("Google Workspace credential requires at least one OAuth scope");

  for (const scope of scopes) {
    if (!GOOGLE_WORKSPACE_SCOPE_SET.has(scope)) {
      throw new Error(`Google Workspace scope is not allowed by Carlos Office: ${scope}`);
    }
  }
  return scopes;
};

const parseGoogleServiceAccount = value => {
  let parsed;
  try {
    parsed = JSON.parse(String(value ?? ""));
  } catch {
    throw new Error("Google Workspace secret must be a valid service-account JSON key");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.type !== "service_account") {
    throw new Error("Google Workspace secret must be a Google service-account JSON key");
  }
  if (!clean(parsed.client_email)) throw new Error("Google service-account JSON is missing client_email");
  if (!clean(parsed.private_key)) throw new Error("Google service-account JSON is missing private_key");
  if (!String(parsed.private_key).includes("BEGIN PRIVATE KEY")) {
    throw new Error("Google service-account private_key is not a valid PEM private key");
  }

  return parsed;
};

const toMetadata = row => {
  if (!row) return null;
  const type = normalizeType(row.type);
  const defaults = authDefaults(type);
  return {
    service: row.service,
    type,
    allowedHosts: parseHosts(row.allowed_hosts),
    headerName: clean(row.header_name) || defaults.headerName,
    scheme: row.scheme == null ? defaults.scheme : String(row.scheme),
    subject: type === GOOGLE_WORKSPACE_TYPE ? clean(row.subject) || null : null,
    scopes: type === GOOGLE_WORKSPACE_TYPE ? normalizeScopes(parseJsonArray(row.scopes)) : [],
    updatedAt: row.updated_at,
  };
};

const hostAllowed = (hostname, allowedHosts) => allowedHosts.some(pattern => {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1);
    return hostname.endsWith(suffix) && hostname.length > suffix.length;
  }
  return hostname === pattern;
});

const pathIs = (pathname, prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`);

const googleWorkspaceTargetAllowed = target => {
  if (target.protocol !== "https:") return false;
  const host = target.hostname.toLowerCase();
  const path = target.pathname;

  if (host === "gmail.googleapis.com") {
    return pathIs(path, "/gmail") || pathIs(path, "/upload/gmail") || pathIs(path, "/batch/gmail");
  }
  if (host === "www.googleapis.com") {
    return pathIs(path, "/drive")
      || pathIs(path, "/upload/drive")
      || pathIs(path, "/batch/drive")
      || pathIs(path, "/calendar")
      || pathIs(path, "/batch/calendar");
  }
  if (host === "docs.googleapis.com") return pathIs(path, "/v1/documents");
  if (host === "sheets.googleapis.com") return pathIs(path, "/v4/spreadsheets");
  if (host === "slides.googleapis.com") return pathIs(path, "/v1/presentations");
  if (host === "chat.googleapis.com") return pathIs(path, "/v1");
  if (host === "keep.googleapis.com") return pathIs(path, "/v1");
  if (host === "meet.googleapis.com") return pathIs(path, "/v2");
  return false;
};

const encodeJwtPart = value => Buffer.from(JSON.stringify(value)).toString("base64url");

const signedGoogleAssertion = ({ key, subject, scopes, nowMs }) => {
  const nowSeconds = Math.floor(nowMs / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
    ...(clean(key.private_key_id) ? { kid: clean(key.private_key_id) } : {}),
  };
  const claims = {
    iss: clean(key.client_email),
    sub: subject,
    scope: scopes.join(" "),
    aud: GOOGLE_TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };
  const unsigned = `${encodeJwtPart(header)}.${encodeJwtPart(claims)}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .end()
    .sign(key.private_key)
    .toString("base64url");
  return `${unsigned}.${signature}`;
};

export const createCredentialService = ({
  dbPath = DATABASE_PATH,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) => {
  const path = resolve(dbPath);
  const googleTokenCache = new Map();

  const withDb = callback => withDatabase(db => {
    ensureCredentialSchema(db);
    return callback(db);
  }, { path });

  const readRow = service => withDb(db => db.prepare("SELECT * FROM credentials WHERE service = ?").get(service) ?? null);

  const listCredentials = () => withDb(db => db.prepare(`
    SELECT service, type, allowed_hosts, header_name, scheme, subject, scopes, updated_at
    FROM credentials
    ORDER BY service
  `).all().map(toMetadata));

  const getCredential = service => {
    const name = clean(service);
    if (!name) throw new Error("Credential service is required");
    return toMetadata(readRow(name));
  };

  const setCredential = ({
    service,
    secret = null,
    type = null,
    allowedHosts = null,
    headerName = null,
    scheme = null,
    subject = null,
    scopes = null,
  }) => {
    const name = clean(service);
    if (!name) throw new Error("Credential service is required");

    return withDb(db => {
      const current = db.prepare("SELECT * FROM credentials WHERE service = ?").get(name) ?? null;
      const currentType = current ? normalizeType(current.type) : null;
      const nextType = normalizeType(type ?? currentType ?? "bearer");
      const defaults = authDefaults(nextType);
      const suppliedSecret = typeof secret === "string" && secret.trim() ? secret : null;

      if (
        current
        && currentType !== nextType
        && (currentType === GOOGLE_WORKSPACE_TYPE || nextType === GOOGLE_WORKSPACE_TYPE)
        && !suppliedSecret
      ) {
        throw new Error("Changing to or from Google Workspace authentication requires a new secret");
      }

      let nextSecret = suppliedSecret ?? current?.token;
      if (!nextSecret) throw new Error("Credential secret is required for a new service");

      let nextHosts;
      let nextHeaderName;
      let nextScheme;
      let nextSubject = null;
      let nextScopes = [];

      if (nextType === GOOGLE_WORKSPACE_TYPE) {
        nextSecret = JSON.stringify(parseGoogleServiceAccount(nextSecret));
        nextHosts = [...GOOGLE_WORKSPACE_HOSTS];
        nextHeaderName = "Authorization";
        nextScheme = "Bearer";
        nextSubject = normalizeSubject(subject ?? current?.subject);
        nextScopes = scopes == null
          ? normalizeGoogleScopes(parseJsonArray(current?.scopes).length ? parseJsonArray(current.scopes) : GOOGLE_WORKSPACE_SCOPES)
          : normalizeGoogleScopes(scopes);
      } else {
        nextHosts = allowedHosts == null ? parseHosts(current?.allowed_hosts) : normalizeHosts(allowedHosts);
        if (!nextHosts.length) throw new Error("Credential requires at least one allowed host");

        nextHeaderName = clean(headerName)
          || (type == null && current ? clean(current.header_name) : "")
          || defaults.headerName;
        nextScheme = scheme == null
          ? (type == null && current && current.scheme != null ? String(current.scheme) : defaults.scheme)
          : String(scheme).trim();
        if (!nextHeaderName) throw new Error("Credential headerName is required");
      }

      const updatedAt = new Date(now()).toISOString();

      db.prepare(`INSERT INTO credentials (
        service, token, type, allowed_hosts, header_name, scheme, subject, scopes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(service) DO UPDATE SET
        token = excluded.token,
        type = excluded.type,
        allowed_hosts = excluded.allowed_hosts,
        header_name = excluded.header_name,
        scheme = excluded.scheme,
        subject = excluded.subject,
        scopes = excluded.scopes,
        updated_at = excluded.updated_at`)
        .run(
          name,
          nextSecret,
          nextType,
          JSON.stringify(nextHosts),
          nextHeaderName,
          nextScheme,
          nextSubject,
          JSON.stringify(nextScopes),
          updatedAt,
        );

      googleTokenCache.delete(name);
      return toMetadata({
        service: name,
        type: nextType,
        allowed_hosts: JSON.stringify(nextHosts),
        header_name: nextHeaderName,
        scheme: nextScheme,
        subject: nextSubject,
        scopes: JSON.stringify(nextScopes),
        updated_at: updatedAt,
      });
    });
  };

  const deleteCredential = service => {
    const name = clean(service);
    if (!name) throw new Error("Credential service is required");
    const result = withDb(db => ({
      service: name,
      deleted: db.prepare("DELETE FROM credentials WHERE service = ?").run(name).changes > 0,
    }));
    googleTokenCache.delete(name);
    return result;
  };

  const getGoogleAccessToken = async (row, metadata) => {
    if (typeof fetchImpl !== "function") throw new Error("Google Workspace authentication requires fetch");

    const cached = googleTokenCache.get(row.service);
    const nowMs = now();
    if (
      cached
      && cached.updatedAt === row.updated_at
      && cached.expiresAt - nowMs > 60_000
    ) {
      return cached.accessToken;
    }

    const key = parseGoogleServiceAccount(row.token);
    const assertion = signedGoogleAssertion({
      key,
      subject: metadata.subject,
      scopes: metadata.scopes,
      nowMs,
    });

    const response = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
      redirect: "error",
    });

    const text = await response.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }

    if (!response.ok) {
      const detail = clean(body.error_description) || clean(body.error) || `HTTP ${response.status}`;
      throw new Error(`Google Workspace token exchange failed: ${detail}`);
    }

    const accessToken = clean(body.access_token);
    if (!accessToken) throw new Error("Google Workspace token exchange returned no access_token");

    const expiresInSeconds = Number(body.expires_in);
    const expiresAt = nowMs + (
      Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
        ? expiresInSeconds * 1000
        : 3_600_000
    );

    googleTokenCache.set(row.service, {
      updatedAt: row.updated_at,
      accessToken,
      expiresAt,
    });
    return accessToken;
  };

  const validateCredentialTarget = (service, url) => {
    const name = clean(service);
    if (!name) throw new Error("Credential service is required");
    let target;
    try { target = new URL(url); } catch { throw new Error(`Invalid credential target URL: ${url}`); }
    const row = readRow(name);
    if (!row) throw new Error(`No credential stored for service "${name}"`);
    const metadata = toMetadata(row);
    const hostname = target.hostname.toLowerCase();
    if (!metadata.allowedHosts.length) throw new Error(`Credential "${name}" has no allowed hosts configured`);
    if (!hostAllowed(hostname, metadata.allowedHosts)) {
      throw new Error(`Credential "${name}" is not allowed for host "${hostname}"`);
    }
    return { row, metadata, target };
  };

  const applyCredential = async ({ service, url, headers = {} }) => {
    const { row, metadata, target } = validateCredentialTarget(service, url);

    let value = row.token;
    if (metadata.type === GOOGLE_WORKSPACE_TYPE) {
      if (!googleWorkspaceTargetAllowed(target)) {
        throw new Error(`Credential "${row.service}" may only access approved Google Workspace API routes`);
      }
      value = await getGoogleAccessToken(row, metadata);
    }

    const result = { ...headers };
    for (const key of Object.keys(result)) {
      if (key.toLowerCase() === metadata.headerName.toLowerCase()) delete result[key];
    }
    result[metadata.headerName] = metadata.scheme ? `${metadata.scheme} ${value}` : value;
    return result;
  };

  const getProviderApiKey = ({ service, url }) => {
    if (!clean(service)) return null;
    const { row, metadata } = validateCredentialTarget(service, url);
    if (metadata.type !== "bearer" || metadata.headerName.toLowerCase() !== "authorization" || metadata.scheme.toLowerCase() !== "bearer") {
      throw new Error(`Provider credential "${row.service}" must use Bearer authorization for the Ollama-compatible adapter`);
    }
    return row.token;
  };

  return {
    dbPath: path,
    listCredentials,
    getCredential,
    setCredential,
    deleteCredential,
    applyCredential,
    getProviderApiKey,
  };
};

const credentials = createCredentialService();

export const listCredentials = credentials.listCredentials;
export const getCredential = credentials.getCredential;
export const setCredential = credentials.setCredential;
export const deleteCredential = credentials.deleteCredential;
export const applyCredential = credentials.applyCredential;
export const getProviderApiKey = credentials.getProviderApiKey;
