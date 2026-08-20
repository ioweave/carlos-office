import { recordEvent } from "../controllers/EventController.mjs";
import { getProcess, saveProcess, validateGraph } from "../controllers/ProcessController.mjs";
import { createSchedule } from "../controllers/ScheduleController.mjs";
import { saveSkill } from "../registry/Skills.mjs";
import { saveTool } from "../registry/Tools.mjs";

const MAX_PLAN_STEPS = 5;
const PLAN_TYPES = new Set(["tool", "skill", "create_process", "create_schedule"]);

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

const errorMessage = error => error instanceof Error ? error.message : String(error);

const requireText = (value, label) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
};

const normalizeProcess = process => {
  if (!isObject(process)) throw new Error("Nora Process definition must be an object");

  return {
    name: requireText(process.name, "Process name"),
    purpose: typeof process.purpose === "string" ? process.purpose : "",
    inputs: Array.isArray(process.inputs) ? process.inputs : [],
    start: process.start,
    end: process.end,
    tasks: process.tasks,
    edges: process.edges,
  };
};

export const getNoraRequestDecisionInstruction = () => [
  "Decide how Carlos's latest request should be handled.",
  "",
  "Allowed actions:",
  '- "respond": answer directly without a Workflow.',
  '- "clarify": ask Carlos only when information is genuinely required before safe execution.',
  '- "process": instantiate an existing Process.',
  '- "adhoc": create and execute a one-off Workflow.',
  '- "create_process": create or update one reusable Process without executing it.',
  '- "create_schedule": create one Schedule for an existing Process.',
  '- "tool": create or update one reusable executable Tool.',
  '- "skill": create or update one reusable Markdown Skill.',
  '- "plan": perform 2-5 durable creation steps when one request requires multiple related capabilities.',
  "",
  "Use plan only for compound creation. Plan steps may be tool, skill, create_process, or create_schedule.",
  "When scheduled behavior needs a missing capability, create the Tool, then Process, then Schedule.",
  "Never claim a notification/alarm capability exists unless it is available or created in the plan.",
  "Generated graph nodes may only be start/task/end. Edges are [fromTaskId,toTaskId].",
  "For a Tool, return complete valid ESM source with no Markdown fences. Export it as default or `tool`.",
  "For a Skill, return complete Markdown content.",
  "",
  "Return one of:",
  '{"action":"respond","response":"..."}',
  '{"action":"clarify","response":"..."}',
  '{"action":"process","process":"Process Name","inputs":{},"config":{},"response":"optional"}',
  '{"action":"adhoc","workflow":{"start":"start","end":"end","tasks":{},"edges":[]},'
    + '"inputs":{},"config":{},"response":"optional"}',
  '{"action":"create_process","process":{"name":"...","purpose":"...","inputs":[],'
    + '"start":"start","end":"end","tasks":{},"edges":[]},"response":"optional"}',
  '{"action":"create_schedule","schedule":{"id":"optional","process":"...","enabled":true,'
    + '"timing":{"type":"cron","value":"0 5 * * *"},"inputs":{},"config":{}},"response":"optional"}',
  '{"action":"tool","name":"tool-name","source":"complete ESM source","response":"optional"}',
  '{"action":"skill","name":"skill-name","content":"complete Markdown","response":"optional"}',
  '{"action":"plan","steps":[{"type":"tool"},{"type":"create_process"},'
    + '{"type":"create_schedule"}],"response":"optional"}',
].join("\n");

export const ensureValidGeneratedGraph = async ({
  definition,
  label,
  askForJson,
  modelSelection,
}) => {
  if (!isObject(definition)) throw new Error(`${label} definition must be an object`);

  try {
    validateGraph(definition);
    return structuredClone(definition);
  } catch (validationError) {
    const repaired = await askForJson(
      [
        `Repair this generated ${label} graph.`,
        "",
        "The graph is invalid and must satisfy all Carlos Office graph invariants:",
        '- nodes are only type "start", "task", or "end";',
        "- exactly one start node and exactly one end node;",
        "- every edge is [fromTaskId, toTaskId] and references existing nodes;",
        "- no self-edges or duplicate edges;",
        "- start has no incoming edges and end has no outgoing edges;",
        "- the graph is acyclic;",
        "- every node is reachable from start;",
        "- every node can reach end.",
        "",
        "Preserve the requested semantics. Return only the repaired graph object:",
        '{"start":"start","end":"end","tasks":{},"edges":[]}',
      ].join("\n"),
      {
        validationError: errorMessage(validationError),
        invalidDefinition: definition,
      },
      modelSelection,
    );

    validateGraph(repaired);
    return structuredClone(repaired);
  }
};

export const createOrUpdateTool = async (name, source) => {
  const toolName = requireText(name, "Tool name");
  const toolSource = requireText(source, "Tool source");
  const tool = await saveTool(toolName, toolSource);
  await recordEvent("nora.tool_saved", { tool: tool.name });
  return tool;
};

export const createOrUpdateSkill = async (name, content) => {
  const skillName = requireText(name, "Skill name");
  const skillContent = requireText(content, "Skill content");
  const skill = await saveSkill(skillName, skillContent);
  await recordEvent("nora.skill_saved", { skill: skill.name });
  return skill;
};

export const createProcess = async ({ process, askForJson, modelSelection }) => {
  const normalized = normalizeProcess(process);
  const graph = await ensureValidGeneratedGraph({
    definition: normalized,
    label: `Process ${normalized.name}`,
    askForJson,
    modelSelection,
  });

  const stored = await saveProcess({
    ...normalized,
    start: graph.start,
    end: graph.end,
    tasks: graph.tasks,
    edges: graph.edges,
  });

  await recordEvent("nora.process_saved", { process: stored.name });
  return stored;
};

export const createProcessSchedule = async schedule => {
  if (!isObject(schedule)) throw new Error("Nora Schedule definition must be an object");
  requireText(schedule.process, "Schedule process");
  if (!getProcess(schedule.process)) throw new Error(`Schedule references unknown Process: ${schedule.process}`);

  const stored = await createSchedule({
    id: schedule.id,
    process: schedule.process,
    enabled: schedule.enabled ?? true,
    timing: schedule.timing,
    inputs: schedule.inputs ?? {},
    config: schedule.config ?? {},
  });

  await recordEvent("nora.schedule_created", {
    scheduleId: stored.id,
    process: stored.process,
  });
  return stored;
};

const validatePlanShape = steps => {
  if (!Array.isArray(steps) || !steps.length) throw new Error("Nora plan requires at least one step");
  if (steps.length > MAX_PLAN_STEPS) throw new Error(`Nora plan cannot exceed ${MAX_PLAN_STEPS} steps`);

  for (const [index, step] of steps.entries()) {
    if (!isObject(step)) throw new Error(`Nora plan step ${index + 1} must be an object`);
    if (!PLAN_TYPES.has(step.type)) throw new Error(`Unsupported Nora plan step: ${step.type}`);
  }
};

const preparePlanProcesses = async ({ steps, askForJson, modelSelection }) => {
  const prepared = [];

  for (const step of steps) {
    if (step.type !== "create_process") {
      prepared.push(structuredClone(step));
      continue;
    }

    const process = normalizeProcess(step.process);
    const graph = await ensureValidGeneratedGraph({
      definition: process,
      label: `Process ${process.name}`,
      askForJson,
      modelSelection,
    });

    prepared.push({
      ...structuredClone(step),
      process: {
        ...process,
        start: graph.start,
        end: graph.end,
        tasks: graph.tasks,
        edges: graph.edges,
      },
    });
  }

  return prepared;
};

const validatePlanProcessReferences = steps => {
  const createdProcesses = new Set();

  for (const step of steps) {
    if (step.type === "create_process") {
      createdProcesses.add(step.process.name);
      continue;
    }

    if (step.type !== "create_schedule") continue;
    const processName = requireText(step.schedule?.process, "Schedule process");
    if (!createdProcesses.has(processName) && !getProcess(processName)) {
      throw new Error(`Schedule Process must exist before its plan step: ${processName}`);
    }
  }
};

export const executeCreationPlan = async ({ steps, askForJson, modelSelection }) => {
  validatePlanShape(steps);
  const prepared = await preparePlanProcesses({ steps, askForJson, modelSelection });
  validatePlanProcessReferences(prepared);

  const results = [];

  for (const step of prepared) {
    if (step.type === "tool") {
      const tool = await createOrUpdateTool(step.name, step.source);
      results.push({ type: "tool", name: tool.name });
      continue;
    }

    if (step.type === "skill") {
      const skill = await createOrUpdateSkill(step.name, step.content);
      results.push({ type: "skill", name: skill.name });
      continue;
    }

    if (step.type === "create_process") {
      const process = await saveProcess(step.process);
      await recordEvent("nora.process_saved", { process: process.name });
      results.push({ type: "process", name: process.name });
      continue;
    }

    const schedule = await createProcessSchedule(step.schedule);
    results.push({ type: "schedule", id: schedule.id, process: schedule.process });
  }

  await recordEvent("nora.plan_completed", { steps: results });
  return results;
};