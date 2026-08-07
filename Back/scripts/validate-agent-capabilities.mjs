import assert from 'node:assert/strict';
import { listTools } from '../src/lib/toolRegistry.mjs';
import { agentDefinitions } from '../src/agents/agents.config.mjs';
import { classifyMcpAction } from '../src/lib/mcpClient.mjs';

const names = agentId => new Set(listTools(agentId).map(tool => tool.name));
const requireTools = (agentId, required) => {
    const available = names(agentId);
    for (const tool of required) assert(available.has(tool), `${agentId} is missing required tool ${tool}`);
};
const forbidTools = (agentId, forbidden) => {
    const available = names(agentId);
    for (const tool of forbidden) assert(!available.has(tool), `${agentId} must not receive ${tool}`);
};

assert.deepEqual(Object.keys(agentDefinitions).sort(), ['dex', 'iris', 'luma', 'marco', 'nora', 'vera']);

requireTools('nora', [
    'memory_search', 'memory_write', 'memory_remember_fact', 'memory_list_facts', 'memory_update_fact', 'memory_forget_fact',
    'knowledge_source_list', 'knowledge_source_register', 'knowledge_source_update', 'knowledge_source_remove',
    'knowledge_note_write', 'knowledge_note_promote', 'knowledge_retention_scan', 'knowledge_retention_directive',
    'web_search', 'fetch_url', 'office_file_list', 'office_file_read', 'office_file_write',
    'mcp_list_servers', 'mcp_list_tools', 'mcp_call', 'monitor_list', 'monitor_read', 'monitor_run',
    'create_agent_job', 'get_agent_job', 'list_agent_jobs', 'retry_agent_job', 'cancel_agent_job',
    'list_agents', 'agent_get_config', 'agent_update_config',
]);
requireTools('marco', ['memory_search', 'web_search', 'fetch_url', 'office_file_write', 'mcp_list_servers', 'mcp_call']);
requireTools('luma', ['memory_search', 'web_search', 'fetch_url', 'office_file_write', 'mcp_list_servers', 'mcp_call']);
requireTools('dex', [
    'project_list_files', 'project_read_file', 'project_search_files', 'project_write_file', 'project_run_check',
    'playwright_inspect_page', 'playwright_check_page', 'playwright_interact', 'mcp_list_servers', 'mcp_call',
]);
requireTools('iris', [
    'web_search', 'fetch_url', 'project_read_file', 'playwright_inspect_page',
    'office_file_write', 'mcp_list_servers', 'mcp_call', 'monitor_list', 'monitor_read', 'monitor_run',
    'memory_list_facts', 'knowledge_source_list', 'knowledge_source_register', 'knowledge_source_update',
    'knowledge_note_write', 'knowledge_retention_scan', 'knowledge_retention_execute',
]);
requireTools('vera', [
    'memory_search', 'web_search', 'fetch_url', 'project_read_file', 'project_run_check',
    'playwright_inspect_page', 'playwright_check_page', 'mcp_list_servers', 'mcp_call', 'monitor_read',
]);

forbidTools('vera', [
    'project_write_file', 'project_delete_file', 'office_file_write', 'office_file_archive', 'agent_update_config',
    'memory_remember_fact', 'memory_update_fact', 'memory_forget_fact', 'knowledge_source_register',
    'knowledge_note_write', 'knowledge_note_promote', 'knowledge_retention_directive', 'knowledge_retention_execute',
]);
forbidTools('iris', [
    'project_write_file', 'project_delete_file', 'agent_update_config',
    'memory_remember_fact', 'memory_update_fact', 'memory_forget_fact', 'knowledge_source_remove',
    'knowledge_note_promote', 'knowledge_retention_directive',
]);
forbidTools('marco', ['project_write_file', 'project_run_check', 'agent_update_config', 'knowledge_retention_execute', 'knowledge_retention_directive']);
forbidTools('luma', ['project_write_file', 'project_run_check', 'agent_update_config', 'knowledge_retention_execute', 'knowledge_retention_directive']);

assert.equal(classifyMcpAction({ name: 'manage_email' }, { operation: 'search' }), 'read');
assert.equal(classifyMcpAction({ name: 'manage_email' }, { operation: 'send' }), 'dangerous');
assert.equal(classifyMcpAction({ name: 'manage_calendar' }, { operation: 'agenda' }), 'read');
assert.equal(classifyMcpAction({ name: 'manage_calendar' }, { operation: 'create' }), 'dangerous');
assert.equal(classifyMcpAction({ name: 'manage_drive' }, { operation: 'upload' }), 'write');
assert.equal(classifyMcpAction({ name: 'manage_drive' }, { operation: 'share' }), 'dangerous');
assert.equal(classifyMcpAction({ name: 'browser_click' }, { selector: '#submit' }), 'dangerous');
assert.equal(classifyMcpAction({ name: 'search_issues', annotations: { readOnlyHint: true } }, {}), 'read');

console.log('Agent capability contract passed.');
for (const agentId of Object.keys(agentDefinitions)) {
    console.log(`${agentId}: ${listTools(agentId).length} tools`);
}
