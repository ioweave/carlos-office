import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createVariableService } from "./VariableService.mjs";

const withService = callback => {
  const directory = mkdtempSync(join(tmpdir(), "carlos-office-variables-"));
  try {
    return callback(createVariableService({ dbPath: join(directory, "store.db") }));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test("stores and lists workspace variables", () => withService(service => {
  const saved = service.setVariable({
    key: "default.repository",
    value: "ioweave/carlos-office",
    description: "Default repository used by coding tasks",
  });

  assert.equal(saved.key, "default.repository");
  assert.equal(service.getVariable("default.repository").value, "ioweave/carlos-office");
  assert.deepEqual(service.listVariables().map(variable => variable.key), ["default.repository"]);
}));

test("updates values without creating duplicates", () => withService(service => {
  service.setVariable({ key: "timezone", value: "America/Guayaquil" });
  service.setVariable({ key: "timezone", value: "America/Bogota", description: "Task timezone" });

  const variables = service.listVariables();
  assert.equal(variables.length, 1);
  assert.equal(variables[0].value, "America/Bogota");
  assert.equal(variables[0].description, "Task timezone");
}));

test("deletes workspace variables", () => withService(service => {
  service.setVariable({ key: "language", value: "es" });
  assert.equal(service.deleteVariable("language").deleted, true);
  assert.equal(service.getVariable("language"), null);
}));

test("rejects invalid variable keys", () => withService(service => {
  assert.throws(
    () => service.setVariable({ key: "bad key", value: "value" }),
    /Workspace variable key/,
  );
}));
