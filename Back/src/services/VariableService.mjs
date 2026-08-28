import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { DATABASE_PATH, LEGACY_CREDENTIALS_PATH, withDatabase } from "./DatabaseService.mjs";

const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
const MAX_VALUE_LENGTH = 65_536;
const MAX_DESCRIPTION_LENGTH = 500;

const normalizeKey = value => {
  const key = typeof value === "string" ? value.trim() : "";
  if (!KEY_PATTERN.test(key)) {
    throw new Error("Workspace variable key must start with a letter and contain only letters, numbers, ., _, or - (max 128 characters)");
  }
  return key;
};

const normalizeValue = value => {
  if (typeof value !== "string") throw new Error("Workspace variable value must be a string");
  if (value.length > MAX_VALUE_LENGTH) {
    throw new Error(`Workspace variable value cannot exceed ${MAX_VALUE_LENGTH} characters`);
  }
  return value;
};

const normalizeDescription = value => {
  if (value == null) return "";
  if (typeof value !== "string") throw new Error("Workspace variable description must be a string");
  const description = value.trim();
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(`Workspace variable description cannot exceed ${MAX_DESCRIPTION_LENGTH} characters`);
  }
  return description;
};

const ensureVariableSchema = db => {
  db.exec(`CREATE TABLE IF NOT EXISTS workspace_variables (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  )`);
};

const toVariable = row => row ? ({
  key: row.key,
  value: row.value,
  description: row.description ?? "",
  updatedAt: row.updated_at,
}) : null;

export const createVariableService = ({ dbPath = DATABASE_PATH } = {}) => {
  const path = resolve(dbPath);
  let legacyChecked = false;
  const withDb = callback => withDatabase(db => {
    ensureVariableSchema(db);
    if (!legacyChecked && path === resolve(DATABASE_PATH) && existsSync(LEGACY_CREDENTIALS_PATH)) {
      const legacy = new DatabaseSync(LEGACY_CREDENTIALS_PATH);
      try {
        const table = legacy.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workspace_variables'",
        ).get();
        if (table) {
          const insert = db.prepare(`INSERT OR IGNORE INTO workspace_variables (key, value, description, updated_at)
            VALUES (?, ?, ?, ?)`);
          for (const row of legacy.prepare("SELECT key, value, description, updated_at FROM workspace_variables").all()) {
            insert.run(row.key, row.value, row.description ?? "", row.updated_at ?? new Date().toISOString());
          }
        }
      } finally {
        legacy.close();
      }
      legacyChecked = true;
    }
    return callback(db);
  }, { path });

  const listVariables = () => withDb(db => db.prepare(`
    SELECT key, value, description, updated_at
    FROM workspace_variables
    ORDER BY key COLLATE NOCASE
  `).all().map(toVariable));

  const getVariable = key => {
    const name = normalizeKey(key);
    return withDb(db => toVariable(db.prepare(`
      SELECT key, value, description, updated_at
      FROM workspace_variables
      WHERE key = ?
    `).get(name)));
  };

  const setVariable = ({ key, value, description = "" }) => {
    const name = normalizeKey(key);
    const nextValue = normalizeValue(value);
    const nextDescription = normalizeDescription(description);
    const updatedAt = new Date().toISOString();

    return withDb(db => {
      db.prepare(`INSERT INTO workspace_variables (key, value, description, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          description = excluded.description,
          updated_at = excluded.updated_at`)
        .run(name, nextValue, nextDescription, updatedAt);

      return { key: name, value: nextValue, description: nextDescription, updatedAt };
    });
  };

  const deleteVariable = key => {
    const name = normalizeKey(key);
    return withDb(db => ({
      key: name,
      deleted: db.prepare("DELETE FROM workspace_variables WHERE key = ?").run(name).changes > 0,
    }));
  };

  return {
    dbPath: path,
    listVariables,
    getVariable,
    setVariable,
    deleteVariable,
  };
};

const variables = createVariableService();

export const listVariables = variables.listVariables;
export const getVariable = variables.getVariable;
export const setVariable = variables.setVariable;
export const deleteVariable = variables.deleteVariable;
