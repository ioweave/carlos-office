import {
  TASK_COMPLETION_MAX_CHARS,
  TASK_OBJECTIVE_MAX_CHARS,
  TASK_OPERATIONS,
  TOOL_FREE_TASK_OPERATIONS,
} from "./WorkflowSchema.mjs";

export const LEGACY_TASK_OPERATION = "legacy";

const OPERATION_SET = new Set(TASK_OPERATIONS);
const TOOL_FREE_SET = new Set(TOOL_FREE_TASK_OPERATIONS);
const ACTION_PATTERNS = Object.freeze({
  search: /\b(search|investigate|investiga|investigar|busca|buscar)\b/i,
  fetch: /\b(fetch|retrieve|download|obtain|obten|obtener|recupera|recuperar|descarga|descargar)\b/i,
  extract: /\b(extract|transcribe|parse|extraer|extrae|extraiga)\b/i,
  inspect: /\b(inspect|review|examine|revisa|revisar|inspecciona|inspeccionar)\b/i,
  verify: /\b(verify|confirm|validate|verifica|verificar|confirma|confirmar|valida|validar)\b/i,
  analyze: /\b(analyze|analyse|evaluate|assess|analiza|analizar|evalua|evaluar)\b/i,
  compare: /\b(compare|contrast|compara|comparar|contrasta|contrastar)\b/i,
  synthesize: /\b(synthesize|summarize|integrate|sintetiza|sintetizar|resume|resumir|integra|integrar)\b/i,
  transform: /\b(transform|convert|normalize|transforma|transformar|convierte|convertir|normaliza|normalizar)\b/i,
  write: /\b(write|draft|generate|create|redacta|redactar|genera|generar|crea|crear|escribe|escribir)\b/i,
  execute: /\b(execute|run|send|delete|update|ejecuta|ejecutar|corre|correr|envia|enviar|elimina|eliminar|actualiza|actualizar)\b/i,
  decide: /\b(decide|choose|select|decide|decidir|elige|elegir|selecciona|seleccionar)\b/i,
});
const SEQUENCE_PATTERN = /\b(and then|then|after that|afterwards|next|y luego|luego|despues|posteriormente|a continuacion)\b/i;
const NUMBERED_ACTION_PATTERN = /(?:^|\s)(?:\(\d+\)|\d+[.)])\s*/g;

const normalizeText = value => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();

const detectedOperations = objective => {
  const text = normalizeText(objective);
  return Object.entries(ACTION_PATTERNS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([operation]) => operation);
};

export const taskAllowsTools = operation => OPERATION_SET.has(operation) && !TOOL_FREE_SET.has(operation);

export const validateAtomicTaskDefinition = (taskId, task, { requireOperation = true } = {}) => {
  if (!task || task.type !== "task") return;
  const operation = typeof task.operation === "string" ? task.operation.trim() : "";
  if (!operation) {
    if (requireOperation) throw new Error(`Task ${taskId} must declare exactly one operation`);
    return;
  }
  if (operation === LEGACY_TASK_OPERATION) {
    if (requireOperation) throw new Error(`Task ${taskId} uses the legacy broad-task contract and must be decomposed`);
    return;
  }
  if (!OPERATION_SET.has(operation)) throw new Error(`Task ${taskId} has unsupported operation: ${operation}`);

  const objective = typeof task.objective === "string" ? task.objective.trim() : "";
  if (!objective) throw new Error(`Task ${taskId} objective must be a non-empty string`);
  if (objective.length > TASK_OBJECTIVE_MAX_CHARS) {
    throw new Error(`Task ${taskId} objective exceeds ${TASK_OBJECTIVE_MAX_CHARS} characters; move context into inputs and split actions`);
  }
  if (typeof task.completion === "string" && task.completion.trim().length > TASK_COMPLETION_MAX_CHARS) {
    throw new Error(`Task ${taskId} completion exceeds ${TASK_COMPLETION_MAX_CHARS} characters`);
  }

  const numberedActions = [...objective.matchAll(NUMBERED_ACTION_PATTERN)];
  if (numberedActions.length > 1) {
    throw new Error(`Task ${taskId} objective contains multiple numbered actions; each action must be its own Task node`);
  }
  if (SEQUENCE_PATTERN.test(normalizeText(objective))) {
    throw new Error(`Task ${taskId} objective contains sequential actions; split them into separate Task nodes`);
  }

  const operations = detectedOperations(objective);
  const foreignOperations = operations.filter(candidate => candidate !== operation);
  if (foreignOperations.length) {
    throw new Error(
      `Task ${taskId} operation is ${operation} but objective also requests ${[...new Set(foreignOperations)].join(", ")}; split the actions`,
    );
  }

  if (Array.isArray(task.tools) && task.tools.length > 1) {
    throw new Error(`Task ${taskId} may use at most one Tool; separate Tool actions into separate Task nodes`);
  }
  if (!taskAllowsTools(operation) && Array.isArray(task.tools) && task.tools.length) {
    throw new Error(`Task ${taskId} operation ${operation} is evidence-only and cannot use Tools`);
  }
};

export const validateAtomicGraph = graph => {
  for (const [taskId, task] of Object.entries(graph?.tasks ?? {})) {
    if (task?.type === "task") validateAtomicTaskDefinition(taskId, task);
  }
  return graph;
};