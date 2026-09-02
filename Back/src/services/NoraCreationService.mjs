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
  if (process.purpose != null && typeof process.purpose !== "string") throw new Error("Process purpose must be a string");
  if (process.inputs != null && !Array.isArray(process.inputs)) throw new Error("Process inputs must be an array");

  return {
    name: requireText(process.name, "Process name"),
    purpose: process.purpose ?? "",
    inputs: process.inputs ?? [],
    start: process.start,
    end: process.end,
    tasks: process.tasks,
    edges: process.edges,
    groups: Array.isArray(process.groups) ? structuredClone(process.groups) : [],
    ...(isObject(process.layout) ? { layout: structuredClone(process.layout) } : {}),
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

const workflowShape = '{"start":"start","end":"end","tasks":{"start":{"type":"start"},"inspect":{"type":"task","name":"Inspect files","objective":"Inspect the relevant files and report findings","tools":["read-file"]},"end":{"type":"end"}},"edges":[["start","inspect"],["inspect","end"]],"groups":[]}';
const mapExample = '{"id":"map-items","type":"map","name":"Map items","members":["inspect"],"source":"upstream.list_items","itemAs":"item","indexAs":"index","concurrency":4,"throttle":{"requests":20,"windowMs":60000}}';
const loopExample = '{"id":"loop-qc","type":"loop","name":"Quality control","members":["inspect"],"maxIterations":3,"minimumScore":0.85,"criteria":"The result must be complete, accurate, and satisfy the Task completion criteria."}';
const researchExecutionExample = '{"maxReasoningTurns":24,"maxToolCalls":36,"maxNoProgressTurns":4}';
const deepResearchExecutionExample = '{"maxReasoningTurns":40,"maxToolCalls":64,"maxNoProgressTurns":4}';

const graphRules = [
  'Graph nodes are only type "start", "task", or "end". Map and Loop are execution Groups, not graph nodes.',
  "Edges are [fromTaskId,toTaskId], remain acyclic, and define dependencies independently of execution Group boundaries.",
  "The tasks object must contain exactly one named start node and one named end node.",
  "Every executable Task uses type task, a concise 2-5 word name (maximum 50 characters), and a non-empty objective.",
  "Task objective contains detailed execution instructions; completion contains acceptance criteria.",
  "Use Task data output when downstream execution needs machine-readable arrays or objects.",
  "Task execution is optional and may contain only maxReasoningTurns (1-64), maxToolCalls (1-128), and maxNoProgressTurns (1-8). Omit it for ordinary work.",
  `For web research requiring several external sources, prefer execution ${researchExecutionExample}. For deep or large-document research, especially when http-content is needed, prefer ${deepResearchExecutionExample}.`,
  "Split broad research into independent source-domain Tasks that can run in parallel, followed by a downstream synthesis Task over their structured data. Do not make one Task perform discovery, acquisition, extraction, and cross-domain synthesis when the work can be decomposed.",
  "Research Tasks should prefer authoritative primary sources and stop source discovery once sufficient authoritative sources satisfy the objective.",
  "When http returns a stored content reference, use http-content search/read against that stored body instead of re-fetching it or loading the entire large document into model context.",
  "Synthesis Tasks should normally consume upstream structured data without web Tools unless a specific missing fact genuinely requires new research.",
  "groups is optional and contains Map or Loop execution scopes. A Task or nested Group may directly belong to at most one Group.",
  "Start and end cannot be Group members. Group nesting must not contain cycles.",
  `Map Group shape: ${mapExample}`,
  "Map is the only collection-iteration runtime primitive. There is no separate For Each implementation or Group type; 'for each' is descriptive wording only. Use type map in every case.",
  "A Map is an execution operator, never a visual or organizational grouping box. Never create a Map merely to label, group, or sequence Tasks.",
  "Create a Map only when its source is genuinely expected to resolve to an array and the enclosed executable Task or Tasks must run once per item.",
  "Use canonical Map source paths. For a Workflow input use workflow.<inputName>. For an upstream Task value use upstream.<producerTaskId>. A nested suffix such as upstream.<producerTaskId>.<property> is valid only when the producer's structured data is an object that actually contains that array property.",
  "Do not combine a producer Task ID and its declared output alias. Example: if Task list-assets has output assets and its data is the array, use upstream.list-assets (preferred) or the unique alias upstream.assets; never use upstream.list-assets.assets.",
  "When a Task is intended to feed a Map directly, its objective/completion must require the Agent completion data field to contain the JSON array itself. Do not rely on a prose output that merely describes the items.",
  "Prefer upstream.<producerTaskId> over output aliases because Task IDs are unambiguous. Never invent an unbound bare Map source name.",
  "If a mapped Task declares an explicit inputs list, include the Map source path. Runtime can also resolve canonical Map sources from completed ancestor Task data, but the graph definition should still state the dependency explicitly.",
  "A Map containing exactly one executable Task is valid only for genuine fan-out/fan-in: an upstream collection is produced, that Task runs once per item, and downstream work outside the Map consumes the aggregate result. Otherwise omit the Map.",
  "A Map iterates its source collection. concurrency is the shared maximum number of active child Task executions across the entire Map, including parallel branches and nested Groups. concurrency 1 means serial iteration; it does not create a different For Each primitive.",
  "Map throttle optionally limits new Task executions to requests per windowMs.",
  "Tasks in one Map preserve their normal graph dependencies for each item. Nested Maps must obey both outer and inner concurrency/rate limits.",
  `Loop Group V1 shape: ${loopExample}`,
  "Loop V1 directly contains exactly one executable Task. Nora independently reviews and scores each candidate result. Rejected or mediocre work is rerun with Nora's feedback until accepted or maxIterations is reached.",
  "Never represent Loop with a graph back-edge. Do not create Store nodes in v1.1.",
];

export const getNoraRequestDecisionInstruction = () => [
  "Decide how Carlos's latest request should be handled.",
  "",
  "Allowed actions:",
  '- "respond": answer directly without a Workflow.',
  '- "clarify": ask Carlos only when information is genuinely required before safe execution.',
  '- "process": instantiate an existing Process and execute it as a Workflow.',
  '- "adhoc": create and execute a one-off Workflow.',
  '- "create_process": create or update one reusable Process without executing it.',
  '- "create_schedule": create one Schedule for an existing Process.',
  '- "tool": create or update one reusable executable Tool.',
  '- "skill": create or update one reusable Markdown Skill.',
  '- "plan": perform 2-5 durable creation steps when one request requires multiple related capabilities.',
  "",
  "Process and ad-hoc Workflows execute automatically after creation unless Carlos explicitly asks only to design or save a reusable Process.",
  "Use plan only for compound creation. Plan steps may be tool, skill, create_process, or create_schedule.",
  "When scheduled behavior needs a missing capability, create the Tool or Skill, then Process, then Schedule.",
  "Do not choose a Schedule ID. Carlos Office assigns Schedule IDs automatically.",
  "Never claim a notification or alarm capability exists unless it is available or created in the plan.",
  ...graphRules,
  `Valid minimal Workflow graph: ${workflowShape}`,
  "Tasks do not name persistent specialist Agents. A Task may constrain provider/model, Tools, Skills, and execution budget; otherwise Nora selects resources at runtime and Carlos Office applies bounded defaults.",
  "Use Maps only for real collection fan-out with a resolvable array source. Do not use Maps as generic containers. Use Loop only when independent Nora QC/retry materially improves a Task.",
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
  '{"action":"create_schedule","schedule":{"process":"...","enabled":true,"timing":{"type":"cron","value":"0 5 * * *"},"inputs":{},"config":{}},"response":"optional"}',
  '{"action":"tool","name":"tool-name","source":"complete ESM source","response":"optional"}',
  '{"action":"skill","name":"skill-name","content":"complete Markdown","response":"optional"}',
  '{"action":"plan","steps":[{"type":"tool"},{"type":"create_process"},{"type":"create_schedule"}],"response":"optional"}',
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
        "The graph is invalid. Satisfy every Carlos Office graph invariant:",
        ...graphRules.map(rule => `- ${rule}`),
        "- every node is reachable from start and can reach end;",
        "- no self-edges or duplicate edges;",
        "- start has no incoming edges and end has no outgoing edges;",
        "- Task inputs, tools, and skills are arrays of names when present;",
        "- Task provider and model are configured together when present;",
        "- Task execution fields, when present, remain inside their validated numeric ranges;",
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
  if (!getProcess(normalized.process)) throw new Error(`Schedule references unknown Process: ${normalized.process}`);

  const stored = await createSchedule(normalized);
  await recordEvent("nora.schedule_created", { scheduleId: stored.id, process: stored.process });
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
    if (step.type === "tool") addUniqueName(plannedTools, requireRegistryName(step.name, "Tool name"), "Tool");
    if (step.type === "skill") addUniqueName(plannedSkills, requireRegistryName(step.name, "Skill name"), "Skill");
    if (step.type === "create_process") addUniqueName(plannedProcesses, requireText(step.process?.name, "Process name"), "Process");
  }

  const prepared = [];
  for (const step of steps) {
    if (step.type === "tool") {
      prepared.push({ type: "tool", name: requireRegistryName(step.name, "Tool name"), source: requireText(step.source, "Tool source") });
      continue;
    }
    if (step.type === "skill") {
      prepared.push({ type: "skill", name: requireRegistryName(step.name, "Skill name"), content: requireText(step.content, "Skill content") });
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
      validateProcessDependencies(process, { plannedTools, plannedSkills, validateModelSelection });
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
  const prepared = await prepareCreationPlan({ steps, askForJson, modelSelection, validateModelSelection });
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