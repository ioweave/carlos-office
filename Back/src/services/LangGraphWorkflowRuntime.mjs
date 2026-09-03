import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";

const here = dirname(fileURLToPath(import.meta.url));
const runtimeDir = resolve(here, "../../ObsidianVault/System/Runtime");
const checkpointPath = resolve(runtimeDir, "langgraph-checkpoints.sqlite");
let checkpointerPromise = null;

const appendValues = (left, right) => [...(left ?? []), ...(Array.isArray(right) ? right : [right])];

const WorkflowState = Annotation.Root({
  completedTasks: Annotation({ reducer: appendValues, default: () => [] }),
});

const getCheckpointer = async () => {
  if (!checkpointerPromise) {
    checkpointerPromise = (async () => {
      await mkdir(runtimeDir, { recursive: true });
      return SqliteSaver.fromConnString(checkpointPath);
    })();
  }
  return checkpointerPromise;
};

const executableTaskIds = workflow => Object.entries(workflow.tasks ?? {})
  .filter(([, task]) => task?.type === "task")
  .map(([taskId]) => taskId);

const incoming = (workflow, nodeId) => workflow.edges
  .filter(([, to]) => to === nodeId)
  .map(([from]) => from);

const addDependencyEdge = (builder, workflow, targetId, target) => {
  const predecessors = incoming(workflow, targetId);
  const executablePredecessors = predecessors.filter(id => workflow.tasks?.[id]?.type === "task");
  if (executablePredecessors.length > 1) builder.addEdge(executablePredecessors, target);
  else if (executablePredecessors.length === 1) builder.addEdge(executablePredecessors[0], target);
  else if (predecessors.includes(workflow.start)) builder.addEdge(START, target);
};

const compileWorkflow = async ({ workflow, runTask }) => {
  const builder = new StateGraph(WorkflowState);
  for (const taskId of executableTaskIds(workflow)) {
    builder.addNode(taskId, async () => {
      await runTask(taskId);
      return { completedTasks: [taskId] };
    });
  }

  for (const taskId of executableTaskIds(workflow)) addDependencyEdge(builder, workflow, taskId, taskId);
  addDependencyEdge(builder, workflow, workflow.end, END);
  const checkpointer = await getCheckpointer();
  return { graph: builder.compile({ checkpointer }), checkpointer };
};

/**
 * Runs or resumes one compiled Carlos Office Workflow on a durable LangGraph thread.
 * A null invocation resumes the latest checkpoint, so successful parallel nodes are not replayed after a sibling failure.
 */
export const runLangGraphWorkflow = async ({ workflow, threadId, runTask, signal = null }) => {
  const { graph, checkpointer } = await compileWorkflow({ workflow, runTask });
  const config = { configurable: { thread_id: threadId } };
  const checkpoint = await checkpointer.getTuple(config);
  return graph.invoke(checkpoint ? null : {}, {
    ...config,
    recursionLimit: Math.max(64, executableTaskIds(workflow).length * 4 + 16),
    ...(signal ? { signal } : {}),
  });
};
