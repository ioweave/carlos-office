import OfficeController from './controllers/OfficeController.mjs';

export default [
    { method: 'GET', path: '/api/health', handler: OfficeController.health },
    { method: 'GET', path: '/api/agents', handler: OfficeController.listAgents },
    { method: 'PUT', path: '/api/agents/{agentId}', handler: OfficeController.updateAgent },
    { method: 'GET', path: '/api/models', handler: OfficeController.listModels },
    { method: 'GET', path: '/api/tools', handler: OfficeController.listTools },
    { method: 'POST', path: '/api/tools/{toolName}', handler: OfficeController.invokeTool },
    { method: 'GET', path: '/api/conversations', handler: OfficeController.listConversations },
    { method: 'GET', path: '/api/conversations/{conversationId}', handler: OfficeController.getConversation },
    { method: 'POST', path: '/api/chat', handler: OfficeController.chat },
    { method: 'GET', path: '/api/jobs', handler: OfficeController.listJobs },
];
