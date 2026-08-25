import { createServer } from "node:http";

import config from "./src/config.mjs";
import { createRouter } from "./src/Router.mjs";
import { stopNora } from "./src/runtime/NoraProcess.mjs";
import { loadKnowledge } from "./src/services/KnowledgeService.mjs";
import { createOfficeStateService } from "./src/services/OfficeStateService.mjs";
import { attachOfficeStateWebSocket } from "./src/services/OfficeStateWebSocketService.mjs";
import { prepareVaultStructure } from "./src/services/VaultMaintenanceService.mjs";
import { reconcileInterruptedWorkflows } from "./src/services/WorkflowRecoveryService.mjs";

import * as noraRegistry from "./src/registry/Nora.mjs";
import * as tools from "./src/registry/Tools.mjs";
import * as skills from "./src/registry/Skills.mjs";
import * as artifacts from "./src/controllers/ArtifactController.mjs";
import * as attachments from "./src/controllers/AttachmentController.mjs";
import * as authorization from "./src/controllers/AuthorizationController.mjs";
import * as conversations from "./src/controllers/ConversationController.mjs";
import { createCredentialController } from "./src/controllers/CredentialController.mjs";
import * as events from "./src/controllers/EventController.mjs";
import { createKnowledgeController } from "./src/controllers/KnowledgeController.mjs";
import * as nora from "./src/controllers/NoraController.mjs";
import { createOfficeStateController } from "./src/controllers/OfficeStateController.mjs";
import * as processes from "./src/controllers/ProcessController.mjs";
import * as providers from "./src/controllers/ProviderController.mjs";
import * as schedules from "./src/controllers/ScheduleController.mjs";
import { createVariableController } from "./src/controllers/VariableController.mjs";
import * as engine from "./src/services/ProcessEngine.mjs";

await prepareVaultStructure();
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

const router = createRouter({
  allowedOrigin: config.frontendOrigin,
  nora,
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
const conversationResources = conversations.createConversationResourceController({
  allowedOrigin: config.frontendOrigin,
  nora,
});
const providerResources = providers.createProviderResourceController({ allowedOrigin: config.frontendOrigin });
const credentials = createCredentialController({ allowedOrigin: config.frontendOrigin });
const knowledge = createKnowledgeController({ allowedOrigin: config.frontendOrigin });
const variables = createVariableController({ allowedOrigin: config.frontendOrigin });

const officeStateService = createOfficeStateService({
  nora,
  processes,
  conversations,
  authorization,
  engine,
  skills,
  attachments,
  artifacts,
});
await officeStateService.initialize();

const officeState = createOfficeStateController({
  allowedOrigin: config.frontendOrigin,
  noraRegistry,
  nora,
  service: officeStateService,
});

const server = createServer((req, res) => {
  if (conversationResources.matches(req)) {
    void conversationResources.handle(req, res);
    return;
  }
  if (providerResources.matches(req)) {
    void providerResources.handle(req, res);
    return;
  }
  if (officeState.matches(req)) {
    void officeState.handle(req, res);
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

const officeStateSocket = attachOfficeStateWebSocket({
  server,
  allowedOrigin: config.frontendOrigin,
  service: officeStateService,
});

server.listen(config.port, config.host, () => {
  console.log(`Carlos Office platform listening on http://${config.host}:${config.port}`);
});

schedules.startScheduler(runScheduledWorkflow);

const shutdown = () => {
  schedules.stopScheduler();
  officeStateSocket.close();
  officeStateService.dispose();
  engine.shutdownProcessEngine();
  stopNora();
  server.close(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
