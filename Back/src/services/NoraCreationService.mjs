import { recordEvent } from "../controllers/EventController.mjs";
import {
  getProcess,
  saveProcess,
  validateGraph,
  validateProcessDefinition,
} from "../controllers/ProcessController.mjs";
import { createSchedule, validateScheduleTiming } from "../controllers/ScheduleController.mjs";
import { getSkill, saveSkill } from "../registry/Skills.mjs";
import { getTool, saveTool } from "../registry/Tools.mjs";
import { normalizeGeneratedGraph } from "./WorkflowGraphService.mjs";

const MIN_PLAN_STEPS = 2;
const MAX_PLAN_STEPS = 5;
const PLAN_TYPES = new Set(["tool", "skill", "create_process", "create_schedule"]);
const PLAN_PHASE = Object.freeze({ tool: 0, skill: 0, create_process: 1, create_schedule: 2 });
const REGISTRY_NAME = /^[a-zA-Z0-9_-]+$/;

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const errorMessage = error => error instanceof Error ? error.message : String(error);

const requireText = (value, label) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
};

const requireRegistryName = (value, label) => {
  const name = requireText(value, label);
  if (!REGISTRY_NAME.test(name)) throw new Error(`Invalid ${label.toLowerCase()}: ${name}`);
  return name;
};

const addUniqueName = (names, name, label) => {
  if (names.has(name)) throw new Error(`Nora plan contains duplicate ${label}: ${name}`);
  names.add(name);
};

const normalizeProcess = process => {
  if (!isObject(process)) throw new Error("Nora Process definition must be an object");

  if (process.purpose != null && typeof process.purpose !== "string") {
    throw new Error("Process purpose must be a string");
  }
  if (process.inputs != null && !Array.isArray(process.inputs)) {
    throw new Error("Process inputs must be an array");
  }

  return {
    name: requireText(process.name, "Process name"),
    purpose: process.purpose ?? "",
    inputs: process.inputs ?? [],
    start: process.start,
    end: process.end,
    tasks: process.tasks,
    edges: process.edges,
  };
};

const normalizeSchedule = schedule => {
  if (!isObject(schedule)) throw new Error("Nora Schedule definition must be an object");

  const process = requireText(schedule.process, "Schedule process");
  const enabled = schedule.enabled ?? true;
  const inputs = schedule.inputs ?? {};
  const config = schedule.config ?? {};

  if (typeof enabled !== "boolean") throw new Error("Schedule enabled must be a boolean");
  if (!isObject(inputs)) throw new Error("Schedule inputs must be an object");
  if (!isObject(config)) throw new Error("Schedule config must be an object");
  validateScheduleTiming(schedule.timing);

  return {
    process,
    enabled,
    timing: structuredClone(schedule.timing),
    inputs: structuredClone(inputs),
    config: structuredClone(config),
  };
};

const validateProcessDependencies = (
  process,
  {
    plannedTools = new Set(),
    plannedSkills = new Set(),
    validateModelSelection = null,
  } = {},
) => {
  for (const [taskId, task] of Object.entries(process.tasks)) {
    if (task.type !== "task") continue;

    for (const toolName of task.tools ?? []) {
      if (!plannedTools.has(toolName) && !getTool(toolName)) {
        throw new Error(`Process ${process.name} Task ${taskId} uses unknown Tool: ${toolName}`);
      }
    }

    for (const skillName of task.skills ?? []) {
      if (!plannedSkills.has(skillName) && !getSkill(skillName)) {
        throw new Error(`Process ${process.name} Task ${taskId} uses unknown Skill: ${skillName}`);
      }
    }

    if (task.provider || task.model) {
      if (typeof validateModelSelection !== "function") {
        throw new Error(`Process ${process.name} Task ${taskId} model selection cannot be validated`);
      }
      validateModelSelection({ provider: task.provider, model: task.model });
    }
  }
};

const workflowShape = '{"start":"start","end":"end","tasks":{"start":{"type":"start"},"inspect":{"type":"task","objective":"Inspect the relevant files and report findings","tools":["read-file"]},"end":{"type":"end"}},"edges":[["start","inspect"],["inspect","end"]]}';

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
  "When scheduled behavior needs a missing capability, create the Tool or Skill, then Process, then Schedule.",
  "Do not choose a Schedule ID. Carlos Office assigns Schedule IDs automatically.",
  "Never claim a notification or alarm capability exists unless it is available or created in the plan.",
  "Generated graph nodes may only be start, task, or end. Edges are [fromTaskId,toTaskId].",
  "The tasks object MUST contain the named start and end nodes with types start and end.",
  "Every executable task MUST use type task and a non-empty objective. Do not use description instead of objective.",
  `Valid minimal Workflow graph: ${workflowShape}`,
  "Tasks do not name persistent specialist Agents. A Task may constrain provider/model, Tools, and Skills; otherwise Nora selects them at runtime.",
  "For a Tool, return complete valid ESM source with no Markdown fences.",
  "A Tool must export its Tool object as default or as `tool` and use only available Node APIs or dependencies.",
  "Tool approval is an autonomous authority boundary, not a second confirmation for work Carlos directly requested.",
  "Set requiresApproval true only for high-impact external or irreversible actions such as deletion, spending, external communication/publication, or credential/security/account changes.",
  "Routine local reads, file create/update/overwrite, code edits, and Carlos Office registry changes should not require approval.",
  "For a Skill, return complete Markdown content.",
  "",
  "Return one of:",
  '{"action":"respond","response":"..."}',
  '{"action":"clarify","response":"..."}',
  '{"action":"process","process":"Process Name","inputs":{},"config":{},"response":"optional"}',
  `{"action":"adhoc","workflow":${workflowShape},"inputs":{},"config":{},"response":"optional"}`,
  `{"action":"create_process","process":{"name":"...","purpose":"...","inputs":[],${workflowShape.slice(1)},"response":"optional"}`,
  '{"action":"create_schedule","schedule":{"process":"...","enabled":true,'
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

  const normalized = normalizeGeneratedGraph(definition);
  try {
    validateGraph(normalized);
    return structuredClone(normalized);
  } catch (validationError) {
    const repaired = await askForJson(
      [
        `Repair this generated ${label} graph.`,
        "",
        "The graph is invalid and must satisfy all Carlos Office graph invariants:",
        '- nodes are only type "start", "task", or "end";',
        "- exactly one start node and exactly one end node;",
        "- tasks[start] has type start and tasks[end] has type end;",
        "- every executable task has type task and a non-empty objective; never use description instead of objective;",
        "- every edge is [fromTaskId, toTaskId] and references existing nodes;",
        "- no self-edges or duplicate edges;",
        "- start has no incoming edges and end has no outgoing edges;",
        "- the graph is acyclic;",
        "- every node is reachable from start;",
        "- every node can reach end;",
        "- Task inputs, tools, and skills are arrays of names when present;",
        "- Task provider and model are configured together when present;",
        "- Task definitions do not contain persistent Agent identities.",
        "",
        `Preserve the requested semantics. Return only a graph shaped like: ${workflowShape}`,
      ].join("\n"),
      {
        validationError: errorMessage(validationError),
        invalidDefinition: normalized,
      },
      modelSelection,
    );

    const normalizedRepair = normalizeGeneratedGraph(repaired);
    validateGraph(normalizedRepair);
    return structuredClone(normalizedRepair);
  }
};

export const createOrUpdateTool = async (name, source) => {
  const toolName = requireRegistryName(name, "Tool name");
  const toolSource = requireText(source, "Tool source");
  const tool = await saveTool(toolName, toolSource);
  await recordEvent("nora.tool_saved", { tool: tool.name });
  return tool;
};

export const createOrUpdateSkill = async (name, content) => {
  const skillName = requireRegistryName(name, "Skill name");
  const skillContent = requireText(content, "Skill content");
  const skill = await saveSkill(skillName, skillContent);
  await recordEvent("nora.skill_saved", { skill: skill.name });
  return skill;
};

export const createProcess = async ({
  process,
  askForJson,
  modelSelection,
  validateModelSelection,
}) => {
  const initial = normalizeProcess(process);
  const graph = await ensureValidGeneratedGraph({
    definition: initial,
    label: `Process ${initial.name}`,
    askForJson,
    modelSelection,
  });
  const normalized = normalizeProcess({ ...initial, ...graph });
  validateProcessDefinition(normalized);
  validateProcessDependencies(normalized, { validateModelSelection });

  const stored = await saveProcess(normalized);
  await recordEvent("nora.process_saved", { process: stored.name });
  return stored;
};

export const createProcessSchedule = async schedule => {
  const normalized = normalizeSchedule(schedule);
  if (!getProcess(normalized.process)) {
    throw new Error(`Schedule references unknown Process: ${normalized.process}`);
  }

  const stored = await createSchedule(normalized);
  await recordEvent("nora.schedule_created", {
    scheduleId: stored.id,
    process: stored.process,
  });
  return stored;
};

const validatePlanShape = steps => {
  if (!Array.isArray(steps)) throw new Error("Nora plan steps must be an array");
  if (steps.length < MIN_PLAN_STEPS || steps.length > MAX_PLAN_STEPS) {
    throw new Error(`Nora plan must contain ${MIN_PLAN_STEPS}-${MAX_PLAN_STEPS} steps`);
  }

  for (const [index, step] of steps.entries()) {
    if (!isObject(step)) throw new Error(`Nora plan step ${index + 1} must be an object`);
    if (!PLAN_TYPES.has(step.type)) throw new Error(`Unsupported Nora plan step: ${step.type}`);
  }
};

const prepareCreationPlan = async ({
  steps,
  askForJson,
  modelSelection,
  validateModelSelection,
}) => {
  validatePlanShape(steps);

  const plannedTools = new Set();
  const plannedSkills = new Set();
  const plannedProcesses = new Set();

  for (const step of steps) {
    if (step.type === "tool") {
      addUniqueName(plannedTools, requireRegistryName(step.name, "Tool name"), "Tool");
    }
    if (step.type === "skill") {
      addUniqueName(plannedSkills, requireRegistryName(step.name, "Skill name"), "Skill");
    }
    if (step.type === "create_process") {
      addUniqueName(plannedProcesses, requireText(step.process?.name, "Process name"), "Process");
    }
  }

  const prepared = [];
  for (const step of steps) {
    if (step.type === "tool") {
      prepared.push({
        type: "tool",
        name: requireRegistryName(step.name, "Tool name"),
        source: requireText(step.source, "Tool source"),
      });
      continue;
    }

    if (step.type === "skill") {
      prepared.push({
        type: "skill",
        name: requireRegistryName(step.name, "Skill name"),
        content: requireText(step.content, "Skill content"),
      });
      continue;
    }

    if (step.type === "create_process") {
      const initial = normalizeProcess(step.process);
      const graph = await ensureValidGeneratedGraph({
        definition: initial,
        label: `Process ${initial.name}`,
        askForJson,
        modelSelection,
      });
      const process = normalizeProcess({ ...initial, ...graph });
      validateProcessDefinition(process);
      validateProcessDependencies(process, {
        plannedTools,
        plannedSkills,
        validateModelSelection,
      });
      prepared.push({ type: "create_process", process });
      continue;
    }

    const schedule = normalizeSchedule(step.schedule);
    if (!plannedProcesses.has(schedule.process) && !getProcess(schedule.process)) {
      throw new Error(`Schedule references unavailable Process: ${schedule.process}`);
    }
    prepared.push({ type: "create_schedule", schedule });
  }

  return prepared
    .map((step, index) => ({ step, index }))
    .sort((left, right) => PLAN_PHASE[left.step.type] - PLAN_PHASE[right.step.type] || left.index - right.index)
    .map(item => item.step);
};

export const executeCreationPlan = async ({
  steps,
  askForJson,
  modelSelection,
  validateModelSelection,
}) => {
  const prepared = await prepareCreationPlan({
    steps,
    askForJson,
    modelSelection,
    validateModelSelection,
  });
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
