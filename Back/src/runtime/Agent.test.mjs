import assert from "node:assert/strict";
import test from "node:test";

import { Agent } from "./Agent.mjs";

const task = {
  id: "task1",
  workflowId: "workflow1",
  objective: "test",
  input: {},
};
const tools = [{ name: "tool", description: "test", input: {}, output: null }];

test("successful Tool calls do not consume the failure limit", async () => {
  let turns = 0;
  const provider = {
    generate: async () => {
      turns += 1;
      if (turns <= 13) {
        return { content: "", toolCalls: [{ id: `call-${turns}`, name: "tool", input: { turn: turns } }] };
      }
      return { content: "done", toolCalls: [] };
    },
  };
  const agent = new Agent({
    provider,
    model: "test",
    tools,
    invokeTool: async call => ({ ok: true, turn: call.input.turn }),
    maxToolFailures: 2,
  });

  assert.equal(await agent.run(task), "done");
  assert.equal(turns, 14);
});

test("Tool failures are returned to the model so it can recover", async () => {
  let turns = 0;
  const provider = {
    generate: async ({ messages }) => {
      turns += 1;
      if (turns === 1) return { content: "", toolCalls: [{ id: "bad", name: "tool", input: {} }] };
      assert.match(messages.at(-1).content, /^Tool failed: boom$/);
      return { content: "recovered", toolCalls: [] };
    },
  };
  const agent = new Agent({
    provider,
    model: "test",
    tools,
    invokeTool: async () => { throw new Error("boom"); },
    maxToolFailures: 2,
  });

  assert.equal(await agent.run(task), "recovered");
});

test("Task fails only after the configured Tool failure limit", async () => {
  let call = 0;
  const provider = {
    generate: async () => ({
      content: "",
      toolCalls: [{ id: `call-${++call}`, name: "tool", input: {} }],
    }),
  };
  const agent = new Agent({
    provider,
    model: "test",
    tools,
    invokeTool: async () => { throw new Error("boom"); },
    maxToolFailures: 2,
  });

  await assert.rejects(agent.run(task), /Task exceeded the 2 Tool failure limit/);
  assert.equal(call, 2);
});
