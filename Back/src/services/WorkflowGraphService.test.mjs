import assert from "node:assert/strict";
import test from "node:test";

import { normalizeGeneratedGraph, validateGraph } from "./WorkflowGraphService.mjs";

const graphWithTimeout = timeoutMs => ({
  start: "start",
  end: "end",
  tasks: {
    start: { type: "start" },
    inspect: { type: "task", objective: "Inspect the project", timeoutMs },
    end: { type: "end" },
  },
  edges: [["start", "inspect"], ["inspect", "end"]],
});

test("normalizes generated graph boundary nodes and task descriptions", () => {
  const graph = normalizeGeneratedGraph({
    start: "start",
    end: "end",
    tasks: {
      start: { type: "task", description: "wrong generated type" },
      inspect: { type: "task", description: "Inspect the nutrition pipeline" },
      end: {},
    },
    edges: [["start", "inspect"], ["inspect", "end"]],
  });

  assert.equal(graph.tasks.start.type, "start");
  assert.equal(graph.tasks.end.type, "end");
  assert.equal(graph.tasks.inspect.objective, "Inspect the nutrition pipeline");
  assert.equal(validateGraph(graph), true);
});

test("generated executable tasks require a usable objective", () => {
  assert.throws(() => validateGraph({
    start: "start",
    end: "end",
    tasks: {
      start: { type: "start" },
      inspect: { type: "task" },
      end: { type: "end" },
    },
    edges: [["start", "inspect"], ["inspect", "end"]],
  }), /objective must be a non-empty string/);
});

test("Task timeout accepts supported deadlines and explicit no-timeout", () => {
  assert.equal(validateGraph(graphWithTimeout(60_000)), true);
  assert.equal(validateGraph(graphWithTimeout(3_600_000)), true);
  assert.equal(validateGraph(graphWithTimeout(null)), true);
});

test("Task timeout rejects invalid deadlines", () => {
  assert.throws(() => validateGraph(graphWithTimeout(999)), /timeoutMs/);
  assert.throws(() => validateGraph(graphWithTimeout(3_600_001)), /timeoutMs/);
  assert.throws(() => validateGraph(graphWithTimeout("300000")), /timeoutMs/);
});
