import assert from "node:assert/strict";
import test from "node:test";

import { JSONparser, parseProviderJSON } from "./lib.mjs";

test("keeps valid JSON unchanged", () => {
  assert.deepEqual(JSONparser('{"action":"respond","data":{"ok":true}}'), {
    action: "respond",
    data: { ok: true },
  });
});

test("repairs a missing opening object brace", () => {
  assert.deepEqual(JSONparser('"action":"plan","steps":[{"type":"tool"}],"response":"ok"}'), {
    action: "plan",
    steps: [{ type: "tool" }],
    response: "ok",
  });
});

test("repairs a missing opening brace and first property quote", () => {
  assert.deepEqual(JSONparser('action":"plan","steps":[{"type":"tool","name":"read-file"}],"response":"ok"}'), {
    action: "plan",
    steps: [{ type: "tool", name: "read-file" }],
    response: "ok",
  });
});

test("repairs missing outer object braces", () => {
  assert.deepEqual(JSONparser('"action":"plan","steps":[],"response":"ok"'), {
    action: "plan",
    steps: [],
    response: "ok",
  });
});

test("repairs model output containing escaped source code without provider JSON mode", () => {
  const input = '"action":"plan","steps":[{"type":"tool","source":"line 1\\nconst value = { ok: true };\\nline 3"}],"response":"done"}';
  assert.deepEqual(JSONparser(input), {
    action: "plan",
    steps: [{
      type: "tool",
      source: "line 1\nconst value = { ok: true };\nline 3",
    }],
    response: "done",
  });
});

test("repairs truncated model output containing escaped source code", () => {
  const input = 'action":"plan","steps":[{"type":"tool","name":"read-file","source":"import fs from \\"fs/promises\\";\\nexport default {};"}],"response":"done"}';
  assert.deepEqual(JSONparser(input), {
    action: "plan",
    steps: [{
      type: "tool",
      name: "read-file",
      source: 'import fs from "fs/promises";\nexport default {};',
    }],
    response: "done",
  });
});

test("repairs literal control characters inside JSON strings", () => {
  const input = `{"action":"respond","response":"first line
second line\twith tab
{ clientId, clientSecret }"}`;
  assert.deepEqual(JSONparser(input), {
    action: "respond",
    response: "first line\nsecond line\twith tab\n{ clientId, clientSecret }",
  });
});

test("repairs Windows paths without treating path letters as JSON escapes", () => {
  const path = String.raw`\P\gio40plus\functions\_lib\nutrition.js`;
  const input = `{"action":"adhoc","inputs":{"projectPath":"C:${path}"},"response":"line one\\nline two"}`;
  assert.deepEqual(JSONparser(input), {
    action: "adhoc",
    inputs: { projectPath: "C:\\P\\gio40plus\\functions\\_lib\\nutrition.js" },
    response: "line one\nline two",
  });
});

test("preserves multiple structures and text in source order", () => {
  assert.deepEqual(JSONparser('before {"a":1} middle [1,2] after {"b":2}'), {
    "00001_text": "before",
    "00002_object": { a: 1 },
    "00003_text": "middle",
    "00004_array": [1, 2],
    "00005_text": "after",
    "00006_object": { b: 2 },
  });
});

test("recovers malformed nested containers recursively", () => {
  assert.deepEqual(JSONparser('{ outer { inner {"action":"respond"} end } tail }'), {
    "00001_text": "outer",
    "00002_object": {
      "00001_text": "inner",
      "00002_object": { action: "respond" },
      "00003_text": "end",
    },
    "00003_text": "tail",
  });
});

test("ignores braces and brackets inside strings", () => {
  assert.deepEqual(JSONparser('before {"text":"{ not structure } [ neither ]"} after'), {
    "00001_text": "before",
    "00002_object": { text: "{ not structure } [ neither ]" },
    "00003_text": "after",
  });
});

test("provider parser accepts strict JSON", () => {
  assert.deepEqual(parseProviderJSON('{"action":"respond","response":"ok"}'), {
    action: "respond",
    response: "ok",
  });
});

test("provider parser strips a JSON markdown fence", () => {
  assert.deepEqual(parseProviderJSON('```json\n{"action":"respond","response":"ok"}\n```'), {
    action: "respond",
    response: "ok",
  });
});

test("provider parser tolerates a missing closing markdown fence", () => {
  assert.deepEqual(parseProviderJSON('```json\n{"action":"respond","response":"ok"}'), {
    action: "respond",
    response: "ok",
  });
});

test("provider parser extracts one JSON value from surrounding text", () => {
  assert.deepEqual(parseProviderJSON('before\n{"action":"respond","response":"ok"}\nafter'), {
    action: "respond",
    response: "ok",
  });
});

test("provider parser repairs literal newlines and Windows paths", () => {
  const input = `{"action":"respond","response":"C:\\P\\Carlos Office
ready"}`;
  assert.deepEqual(parseProviderJSON(input), {
    action: "respond",
    response: "C:\\P\\Carlos Office\nready",
  });
});

test("provider parser closes a missing outer object brace", () => {
  assert.deepEqual(parseProviderJSON('{"action":"respond","response":"complete answer"'), {
    action: "respond",
    response: "complete answer",
  });
});

test("provider parser closes nested truncated containers", () => {
  const input = '{"action":"adhoc","workflow":{"tasks":{"start":{"type":"start"}},"edges":[]';
  assert.deepEqual(parseProviderJSON(input), {
    action: "adhoc",
    workflow: {
      tasks: { start: { type: "start" } },
      edges: [],
    },
  });
});

test("provider parser does not invent the end of a truncated string", () => {
  assert.throws(
    () => parseProviderJSON('{"action":"respond","response":"unfinished'),
    /does not contain valid JSON/,
  );
});

test("provider parser rejects multiple JSON values", () => {
  assert.throws(
    () => parseProviderJSON('{"a":1}\n{"b":2}'),
    /response is ambiguous/,
  );
});
