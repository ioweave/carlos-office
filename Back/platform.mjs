import { createServer } from "node:http";

import config from "./src/config.mjs";
import { createRouter } from "./src/Router.mjs";
import { stopNora } from "./src/runtime/NoraProcess.mjs";
import { reconcileInterruptedWorkflows } from "./src/services/WorkflowRecoveryService.mjs";

import * as agents from "./src/registry/Agents.mjs";
import * as tools from "./src/registry/Tools.mjs";
import * as skills from "./src/registry/Skills.mjs";
import * as artifacts from "./src/controllers/ArtifactController.mjs";
import * as authorization from "./src/controllers/AuthorizationController.mjs";
import * as conversations from "./src/controllers/ConversationController.mjs";
import * as events from "./src/controllers/EventController.mjs";
import * as nora from "./src/controllers/NoraController.mjs";
import * as processes from "./src/controllers/ProcessController.mjs";
import * as schedules from "./src/controllers/ScheduleController.mjs";
import * as engine from "./src/services/ProcessEngine.mjs";

await events.loadEvents();
await authorization.loadAuthorizations();
await tools.loadTools();
await skills.loadSkills();
await agents.loadAgents();
await processes.loadProcesses();
await reconcileInterruptedWorkflows();
await processes.loadWorkflows();
await conversations.loadConversations();
await schedules.loadSchedules();
await nora.initializeNora();

const runScheduledWorkflow = async workflow => {
  try {
    const execution = await nora.runWorkflow(workflow.id);
    if (execution.workflow.status === "completed") await nora.summarizeWorkflow(workflow.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[schedules] Scheduled Workflow execution failed.", {
      workflowId: workflow.id,
      message,
    });

    try {
      await events.recordEvent("schedule.workflow_failed", {
        workflowId: workflow.id,
        error: message,
      });
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
  agents,
  tools,
  skills,
  engine,
});

const server = createServer((req, res) => {
  void router(req, res);
});

server.listen(config.port, config.host, () => {
  console.log(`Carlos Office platform listening on http://${config.host}:${config.port}`);
});

schedules.startScheduler(runScheduledWorkflow);

const shutdown = () => {
  schedules.stopScheduler();
  engine.shutdownProcessEngine();
  stopNora();
  server.close(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
