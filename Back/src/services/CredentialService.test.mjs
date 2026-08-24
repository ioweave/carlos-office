import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createCredentialService,
  GOOGLE_WORKSPACE_HOSTS,
} from "./CredentialService.mjs";

const withService = async (callback, options = {}) => {
  const directory = mkdtempSync(join(tmpdir(), "carlos-office-credentials-"));
  try {
    return await callback(createCredentialService({
      dbPath: join(directory, "credentials.db"),
      ...options,
    }));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test("stores metadata without returning the secret", async () => withService(async service => {
  const saved = service.setCredential({
    service: "github",
    secret: "secret-token",
    type: "bearer",
    allowedHosts: ["api.github.com"],
  });

  assert.equal(saved.service, "github");
  assert.equal(Object.hasOwn(saved, "secret"), false);
  assert.deepEqual(service.listCredentials()[0].allowedHosts, ["api.github.com"]);
  assert.equal(Object.hasOwn(service.getCredential("github"), "token"), false);
}));

test("preserves an existing secret when updating metadata", async () => withService(async service => {
  service.setCredential({ service: "api", secret: "secret", allowedHosts: ["api.example.com"] });
  service.setCredential({ service: "api", type: "api-key", allowedHosts: ["v2.example.com"], headerName: "X-Key" });

  const headers = await service.applyCredential({ service: "api", url: "https://v2.example.com/data" });
  assert.equal(headers["X-Key"], "secret");
}));

test("injects credentials only into allowed hosts", async () => withService(async service => {
  service.setCredential({
    service: "github",
    secret: "secret-token",
    allowedHosts: ["api.github.com", "*.githubusercontent.com"],
  });

  assert.equal(
    (await service.applyCredential({ service: "github", url: "https://api.github.com/user" })).Authorization,
    "Bearer secret-token",
  );
  assert.equal(
    (await service.applyCredential({ service: "github", url: "https://raw.githubusercontent.com/file" })).Authorization,
    "Bearer secret-token",
  );
  await assert.rejects(
    service.applyCredential({ service: "github", url: "https://example.com/collect" }),
    /not allowed for host/,
  );
}));

test("requires an allowlist before a credential can be stored", async () => withService(async service => {
  assert.throws(
    () => service.setCredential({ service: "unsafe", secret: "secret", allowedHosts: [] }),
    /at least one allowed host/,
  );
}));

test("stores Google service-account JSON in SQLite and exchanges it without exposing the key", async () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  let tokenCalls = 0;
  let claims = null;
  const fetchImpl = async (url, options) => {
    tokenCalls += 1;
    assert.equal(url, "https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(options.body);
    const assertion = form.get("assertion");
    const payload = JSON.parse(Buffer.from(assertion.split(".")[1], "base64url").toString("utf8"));
    claims = payload;

    return new Response(JSON.stringify({
      access_token: "workspace-access-token",
      expires_in: 3600,
      token_type: "Bearer",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  await withService(async service => {
    const saved = service.setCredential({
      service: "google-workspace",
      type: "google-workspace",
      secret: JSON.stringify({
        type: "service_account",
        project_id: "carlos-office",
        private_key_id: "key-id",
        private_key: privateKey,
        client_email: "nora@carlos-office.iam.gserviceaccount.com",
        client_id: "123456789",
        token_uri: "https://oauth2.googleapis.com/token",
      }),
      subject: "carlos@example.com",
      scopes: [
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/calendar.events",
      ],
    });

    assert.equal(saved.type, "google-workspace");
    assert.equal(saved.subject, "carlos@example.com");
    assert.deepEqual(saved.allowedHosts, GOOGLE_WORKSPACE_HOSTS);
    assert.equal(Object.hasOwn(saved, "secret"), false);
    assert.equal(Object.hasOwn(service.getCredential("google-workspace"), "token"), false);

    const headers = await service.applyCredential({
      service: "google-workspace",
      url: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    });

    assert.equal(headers.Authorization, "Bearer workspace-access-token");
    assert.equal(tokenCalls, 1);
    assert.equal(claims.iss, "nora@carlos-office.iam.gserviceaccount.com");
    assert.equal(claims.sub, "carlos@example.com");
    assert.equal(
      claims.scope,
      "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.events",
    );
    assert.equal(claims.aud, "https://oauth2.googleapis.com/token");

    await service.applyCredential({
      service: "google-workspace",
      url: "https://gmail.googleapis.com/gmail/v1/users/me/labels",
    });
    assert.equal(tokenCalls, 1, "cached access token should be reused");

    await assert.rejects(
      service.applyCredential({
        service: "google-workspace",
        url: "https://www.googleapis.com/storage/v1/b",
      }),
      /approved Google Workspace API routes/,
    );
    assert.equal(tokenCalls, 1, "Cloud API rejection must happen before token exchange");
  }, { fetchImpl, now: () => 1_800_000_000_000 });
});

test("rejects Google Workspace scopes outside the fixed Workspace allowlist", async () => withService(async service => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  assert.throws(
    () => service.setCredential({
      service: "google-workspace",
      type: "google-workspace",
      secret: JSON.stringify({
        type: "service_account",
        private_key: privateKey,
        client_email: "nora@carlos-office.iam.gserviceaccount.com",
      }),
      subject: "carlos@example.com",
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    }),
    /scope is not allowed/,
  );
}));
