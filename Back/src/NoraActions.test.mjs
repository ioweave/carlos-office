import assert from "node:assert/strict";
import test from "node:test";

import { NORA_ACTIONS, NORA_DECISION_SCHEMA, normalizeNoraDecision } from "./NoraActions.mjs";

test("enumerates the canonical Carlos request actions", () => {
  assert.deepEqual(NORA_ACTIONS, [
    "respond",
    "clarify",
    "process",
    "adhoc",
    "create_process",
    "create_schedule",
    "tool",
    "skill",
    "plan",
  ]);
});

test("decision schema requires an enumerated action", () => {
  assert.deepEqual(NORA_DECISION_SCHEMA.required, ["action"]);
  assert.deepEqual(NORA_DECISION_SCHEMA.properties.action.enum, NORA_ACTIONS);
});

test("normalizes canonical action casing", () => {
  assert.deepEqual(normalizeNoraDecision({ action: " Respond ", response: "ok" }), {
    action: "respond",
    response: "ok",
  });
});

test("recovers a response-only decision as respond", () => {
  assert.deepEqual(normalizeNoraDecision({ response: "useful answer" }), {
    action: "respond",
    response: "useful answer",
  });
});

test("does not invent respond when executable payload is present", () => {
  assert.throws(
    () => normalizeNoraDecision({ response: "working", workflow: { tasks: {} } }),
    /must include an action/,
  );
});

test("rejects unknown request actions", () => {
  assert.throws(
    () => normalizeNoraDecision({ action: "answer", response: "ok" }),
    /Unknown Nora action: answer/,
  );
});

test("leaves unrelated JSON contracts alone", () => {
  const selection = { provider: "ollama", model: "x", tools: [], skills: [] };
  assert.equal(normalizeNoraDecision(selection), selection);

  const recovery = { action: "retry", reason: "operational" };
  assert.equal(normalizeNoraDecision(recovery), recovery);
});
