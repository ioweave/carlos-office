import { createServer } from "node:http";

import config from "./src/config.mjs";
import { createRouter } from "./src/Router.mjs";
import { attachAppSocket } from "./src/controllers/AppSocketController.mjs";
import * as artifacts from "./src/controllers/ArtifactController.mjs";
import * as authorization from "./src/controllers/AuthorizationController.mjs";
import * as chat from "./src/controllers/ChatController.mjs";
import * as conversations from "./src/controllers/ConversationController.mjs";
import { createCredentialController } from "./src/controllers/CredentialController.mjs";
import * as events from "./src/controllers/EventController.mjs";
import { createKnowledgeController } from "./src/controllers/KnowledgeController.mjs";
import * as nora from "./src/controllers/NoraController.mjs";
import { setNoraModel } from "./src/controllers/NoraConfigController.mjs";
import * as processes from "./src/controllers/ProcessController.mjs";
import * as providers from "./src/controllers/ProviderController.mjs";
import * as schedules from "./src/controllers/ScheduleController.mjs";
import { createStateController } from "./src/controllers/StateController.mjs";
import { createVariableController } from "./src/controllers/VariableController.mjs";
import * as noraRegistry from "./src/registry/Nora.mjs";
import * as skills from "./src/registry/Skills.mjs";
import * as tools from "./src/registry/Tools.mjs";
import { listModels as listNoraModels, startNora, stopNora } from "./src/runtime/NoraProcess.mjs";
import { initializeDatabase } from "./src/services/DatabaseService.mjs";
import { loadKnowledge } from "./src/services/KnowledgeService.mjs";
import * as engine from "./src/services/ProcessEngine.mjs";
import { prepareVaultStructure } from "./src/services/VaultMaintenanceService.mjs";
import { reconcileInterruptedWorkflows } from "./src/services/WorkflowRecoveryService.mjs";

await prepareVaultStructure();
initializeDatabase();
await loadKnowledge();
await events.loadEvents();
await authorization.loadAuthorizations();
await tools.loadTools();
await skills.loadSkills();
await providers.loadProviderPreferences();
await noraRegistry.loadNoraDefinition();
await processes.loadProcesses();
await reconcileInterruptedWorkflows();
await processes.loadWorkflows();
await conversations.loadConversations();
await conversations.migrateLegacyCarlosAttachments();
await schedules.loadSchedules();
await nora.initializeNora();

const normalizeHostname = hostname => String(hostname || "")
  .trim()
  .toLowerCase()
  .replace(/^\[/, "")
  .replace(/\]$/, "");

const isPrivateIpv4 = hostname => {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some(octet => octet < 0 || octet > 255)) return false;
  const [first, second] = octets;
  return first === 10
    || first === 127
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 169 && second === 254);
};

const isPrivateIpv6 = hostname => (
  hostname === "::1"
  || /^(?:fc|fd)[0-9a-f:]*$/i.test(hostname)
  || /^fe[89ab][0-9a-f:]*$/i.test(hostname)
);

const isLocalNetworkOrigin = origin => {
  let parsed;
  try { parsed = new URL(origin); } catch { return false; }
  if (!["http:", "https:"].includes(parsed.protocol)) return false;

  const hostname = normalizeHostname(parsed.hostname);
  return hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || isPrivateIpv4(hostname)
    || isPrivateIpv6(hostname);
};

const rewriteCorsOrigin = (headers, actualOrigin) => {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return headers;
  const rewritten = { ...headers };
  for (const [name, value] of Object.entries(rewritten)) {
    if (name.toLowerCase() === "access-control-allow-origin" && value === config.frontendOrigin) rewritten[name] = actualOrigin;
  }
  return rewritten;
};

const normalizeAcceptedFrontendOrigin = (req, res = null) => {
  const actualOrigin = req.headers.origin ?? null;
  if (!actualOrigin || actualOrigin === config.frontendOrigin || !isLocalNetworkOrigin(actualOrigin)) return false;

  req.headers.origin = config.frontendOrigin;
  if (!res) return true;

  const writeHead = res.writeHead;
  res.writeHead = function writeHeadWithLanOrigin(statusCode, statusMessage, headers) {
    if (typeof statusMessage === "string") {
      return writeHead.call(this, statusCode, statusMessage, rewriteCorsOrigin(headers, actualOrigin));
    }
    return writeHead.call(this, statusCode, rewriteCorsOrigin(statusMessage, actualOrigin));
  };

  const setHeader = res.setHeader;
  res.setHeader = function setHeaderWithLanOrigin(name, value) {
    const nextValue = String(name).toLowerCase() === "access-control-allow-origin" && value === config.frontendOrigin
      ? actualOrigin
      : value;
    return setHeader.call(this, name, nextValue);
  };
  return true;
};

const runScheduledWorkflow = async workflow => {
  try {
    const execution = await nora.runWorkflow(workflow.id);
    if (execution.workflow.status === "completed") await nora.summarizeWorkflow(workflow.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[schedules] Scheduled Workflow execution failed.", { workflowId: workflow.id, message });
    try {
      await events.recordEvent("schedule.workflow_failed", { workflowId: workflow.id, error: message });
    } catch (eventError) {
      console.error("[schedules] Could not record scheduled Workflow failure.", {
        workflowId: workflow.id,
        message: eventError instanceof Error ? eventError.message : String(eventError),
      });
    }
  }
};

const routerNora = { ...nora, listModels: listNoraModels };
const router = createRouter({
  allowedOrigin: config.frontendOrigin,
  nora: routerNora,
  processes,
  conversations,
  artifacts,
  authorization,
  schedules,
  events,
  tools,
  skills,
  engine,
});
const conversationResources = conversations.createConversationResourceController({ allowedOrigin: config.frontendOrigin });

const reloadProviderRuntime = async () => {
  await providers.loadProviderPreferences();
  stopNora();
  await startNora();
};

const providerResources = providers.createProviderResourceController({
  allowedOrigin: config.frontendOrigin,
  onConfigurationChanged: reloadProviderRuntime,
});
const credentials = createCredentialController({
  allowedOrigin: config.frontendOrigin,
  onConfigurationChanged: reloadProviderRuntime,
});
const knowledge = createKnowledgeController({ allowedOrigin: config.frontendOrigin });
const variables = createVariableController({ allowedOrigin: config.frontendOrigin });
const stateController = createStateController({
  nora: { getNoraState: nora.getNoraState, listModels: listNoraModels },
  processes,
  conversations,
  authorization,
  engine,
  skills,
});
await stateController.initialize();

const commands = {
  "state.refresh": async () => {
    await stateController.refresh();
    return { refreshed: true };
  },
  "nora.setModel": setNoraModel,
  "conversation.get": chat.getConversation,
  "conversation.create": chat.createConversation,
  "conversation.rename": chat.renameConversation,
  "conversation.delete": chat.deleteConversation,
  "conversation.setModel": chat.setConversationModel,
  "conversation.send": chat.sendMessage,
  "conversation.editMessage": chat.editMessage,
  "conversation.resendMessage": chat.resendMessage,
  "conversation.cancelRequest": chat.cancelRequest,
  "conversation.deleteAttachments": chat.deleteAttachments,
};

const server = createServer((req, res) => {
  normalizeAcceptedFrontendOrigin(req, res);

  if (conversationResources.matches(req)) {
    void conversationResources.handle(req, res);
    return;
  }
  if (providerResources.matches(req)) {
    void providerResources.handle(req, res);
    return;
  }
  if (credentials.matches(req)) {
    void credentials.handle(req, res);
    return;
  }
  if (knowledge.matches(req)) {
    void knowledge.handle(req, res);
    return;
  }
  if (variables.matches(req)) {
    void variables.handle(req, res);
    return;
  }
  void router(req, res);
});

server.prependListener("upgrade", req => {
  normalizeAcceptedFrontendOrigin(req);
});

const appSocket = attachAppSocket({
  server,
  allowedOrigin: config.frontendOrigin,
  stateController,
  commands,
});

server.listen(config.port, config.host, () => {
  console.log(`Carlos Office platform listening on http://${config.host}:${config.port}`);
});

schedules.startScheduler(runScheduledWorkflow);

const shutdown = () => {
  schedules.stopScheduler();
  appSocket.close();
  stateController.dispose();
  engine.shutdownProcessEngine();
  stopNora();
  server.close(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
