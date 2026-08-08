import OfficeController from './controllers/OfficeController.mjs';
import { streamArtifact } from './lib/artifacts.mjs';
import { runtimeActivitySnapshot } from './lib/runtimeActivity.mjs';
import { listTemporaryConversations } from './lib/temporaryConversations.mjs';

const officeMapWithRuntime = async args => {
    const response = await OfficeController.officeMap(args);
    const conversations = new Map((response.body?.conversations || []).map(item => [item.conversationId, item]));
    listTemporaryConversations({ limit: 300 }).forEach(item => {
        if (!conversations.has(item.conversationId)) conversations.set(item.conversationId, item);
    });
    return {
        ...response,
        body: {
            ...response.body,
            conversations: [...conversations.values()],
            activity: runtimeActivitySnapshot({ limit: 300 }),
        },
    };
};

export default [
    { method: 'GET', path: '/api/health', handler: OfficeController.health },
    { method: 'GET', path: '/api/agents', handler: OfficeController.listAgents },
    { method: 'PUT', path: '/api/agents/{agentId}', handler: OfficeController.updateAgent },
    { method: 'GET', path: '/api/models', handler: OfficeController.listModels },
    { method: 'GET', path: '/api/tools', handler: OfficeController.listTools },
    { method: 'POST', path: '/api/tools/{toolName}', handler: OfficeController.invokeTool },
    { method: 'GET', path: '/api/artifacts/read', handler: OfficeController.readArtifact },
    { method: 'GET', path: '/api/artifacts/stream', handler: ({ query, headers }) => streamArtifact({
        source: query.source,
        path: query.path,
        agentId: query.agentId || 'nora',
        range: headers.range || '',
        download: query.download === '1' || query.download === 'true',
    }) },
    { method: 'GET', path: '/api/memory', handler: OfficeController.listMemory },
    { method: 'GET', path: '/api/memory/read', handler: OfficeController.readMemory },
    { method: 'POST', path: '/api/memory', handler: OfficeController.writeMemory },
    { method: 'GET', path: '/api/memory/facts', handler: OfficeController.listFacts },
    { method: 'GET', path: '/api/knowledge-sources', handler: OfficeController.listKnowledgeSources },
    { method: 'GET', path: '/api/conversations', handler: OfficeController.listConversations },
    { method: 'GET', path: '/api/conversations/{conversationId}', handler: OfficeController.getConversation },
    { method: 'PUT', path: '/api/conversations/{conversationId}', handler: OfficeController.updateConversation },
    { method: 'POST', path: '/api/conversations/{conversationId}/save', handler: OfficeController.saveConversation },
    { method: 'DELETE', path: '/api/conversations/{conversationId}', handler: OfficeController.deleteConversation },
    { method: 'GET', path: '/api/conversations/{conversationId}/attachments/{attachmentId}', handler: OfficeController.getConversationAttachment },
    { method: 'POST', path: '/api/chat', handler: OfficeController.chat },
    { method: 'GET', path: '/api/runtime-activity', handler: ({ query }) => ({
        statusCode: 200,
        body: runtimeActivitySnapshot({
            requestId: query.requestId || '',
            conversationId: query.conversationId || '',
            agentId: query.agentId || '',
            limit: query.limit,
        }),
    }) },
    { method: 'GET', path: '/api/jobs', handler: OfficeController.listJobs },
    { method: 'DELETE', path: '/api/jobs', handler: OfficeController.clearJobs },
    { method: 'POST', path: '/api/jobs/stop-all', handler: OfficeController.stopAllJobs },
    { method: 'GET', path: '/api/jobs/{jobId}', handler: OfficeController.getJob },
    { method: 'DELETE', path: '/api/jobs/{jobId}', handler: OfficeController.deleteJob },
    { method: 'POST', path: '/api/jobs/{jobId}/run', handler: OfficeController.runJob },
    { method: 'POST', path: '/api/jobs/{jobId}/stop', handler: OfficeController.stopJob },
    { method: 'GET', path: '/api/office-map', handler: officeMapWithRuntime },
];
