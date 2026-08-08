import assert from 'node:assert/strict';
import { listTools } from '../src/lib/toolRegistry.mjs';
import { agentDefinitions } from '../src/agents/agents.config.mjs';
import { classifyMcpAction } from '../src/lib/mcpClient.mjs';
import { buildAutomaticProjectContext } from '../src/lib/runtimeContext.mjs';

const names = agentId => new Set(listTools(agentId).map(tool => tool.name));
const sorted = values => [...values].sort();

const approved = {
    nora: [
        'memory_search', 'memory_read', 'memory_list', 'memory_write', 'web_search', 'fetch_url',
        'project_list_files', 'project_read_file', 'project_search_files',
        'playwright_inspect_page', 'playwright_check_page', 'playwright_interact',
        'current_time', 'list_ollama_models', 'list_agents',
        'create_agent_job', 'get_agent_job', 'list_agent_jobs', 'retry_agent_job', 'cancel_agent_job', 'stop_all_agent_jobs', 'clear_agent_jobs',
        'office_file_list', 'office_file_read', 'office_file_write', 'office_file_archive',
        'memory_remember_fact', 'memory_list_facts', 'memory_update_fact', 'memory_forget_fact',
        'knowledge_source_list', 'knowledge_source_register', 'knowledge_source_update', 'knowledge_source_remove',
        'knowledge_note_write', 'knowledge_note_promote', 'knowledge_retention_scan', 'knowledge_retention_directive',
        'mcp_list_servers', 'mcp_list_tools', 'mcp_call', 'monitor_list', 'monitor_read', 'monitor_run',
        'agent_get_config', 'agent_update_config',
    ],
    marco: [
        'memory_search', 'memory_read', 'memory_list', 'memory_write', 'web_search', 'fetch_url', 'current_time',
        'office_file_list', 'office_file_read', 'office_file_write', 'office_file_archive',
        'mcp_list_servers', 'mcp_list_tools', 'mcp_call', 'monitor_list', 'monitor_read',
    ],
    luma: [
        'memory_search', 'memory_read', 'memory_list', 'memory_write', 'web_search', 'fetch_url', 'current_time',
        'office_file_list', 'office_file_read', 'office_file_write', 'office_file_archive',
        'mcp_list_servers', 'mcp_list_tools', 'mcp_call', 'monitor_list', 'monitor_read',
    ],
    dex: [
        'memory_search', 'memory_read', 'memory_list', 'memory_write', 'web_search', 'fetch_url',
        'project_list_files', 'project_read_file', 'project_search_files',
        'playwright_inspect_page', 'playwright_check_page', 'playwright_interact',
        'current_time', 'list_ollama_models',
        'office_file_list', 'office_file_read', 'office_file_write', 'office_file_archive',
        'mcp_list_servers', 'mcp_list_tools', 'mcp_call', 'monitor_list', 'monitor_read',
        'project_write_file', 'project_delete_file', 'project_run_check',
    ],
    iris: [
        'memory_search', 'memory_read', 'memory_list', 'memory_write', 'web_search', 'fetch_url',
        'project_list_files', 'project_read_file', 'project_search_files',
        'playwright_inspect_page', 'playwright_check_page', 'current_time',
        'office_file_list', 'office_file_read', 'office_file_write', 'office_file_archive',
        'memory_list_facts',
        'knowledge_source_list', 'knowledge_source_register', 'knowledge_source_update',
        'knowledge_note_write', 'knowledge_retention_scan', 'knowledge_retention_execute',
        'mcp_list_servers', 'mcp_list_tools', 'mcp_call', 'monitor_list', 'monitor_read', 'monitor_run',
    ],
    vera: [
        'memory_search', 'memory_read', 'memory_list', 'memory_write', 'web_search', 'fetch_url',
        'project_list_files', 'project_read_file', 'project_search_files',
        'playwright_inspect_page', 'playwright_check_page', 'playwright_interact', 'current_time',
        'office_file_list', 'office_file_read',
        'mcp_list_servers', 'mcp_list_tools', 'mcp_call', 'monitor_list', 'monitor_read', 'project_run_check',
    ],
};

assert.deepEqual(Object.keys(agentDefinitions).sort(), Object.keys(approved).sort());
for (const [agentId, allowed] of Object.entries(approved)) {
    const actual = names(agentId);
    assert.deepEqual(
        sorted(actual),
        sorted(allowed),
        `${agentId} capability surface changed. Update the explicit approved allowlist only after reviewing the authority change.`,
    );
}

// Role boundaries that deserve especially explicit regression messages.
for (const forbidden of ['project_write_file', 'project_delete_file', 'office_file_write', 'office_file_archive', 'agent_update_config', 'memory_remember_fact', 'knowledge_note_write', 'knowledge_retention_execute']) {
    assert(!names('vera').has(forbidden), `vera must not receive ${forbidden}`);
}
for (const forbidden of ['project_write_file', 'project_delete_file', 'agent_update_config', 'memory_remember_fact', 'memory_update_fact', 'memory_forget_fact', 'knowledge_source_remove', 'knowledge_note_promote', 'knowledge_retention_directive']) {
    assert(!names('iris').has(forbidden), `iris must not receive ${forbidden}`);
}

// Planning/memory governance must remain explicit in the role definitions.
assert.match(agentDefinitions.nora.system, /Back\/artifacts/i, 'Nora must inspect durable project artifacts before planning.');
assert.match(agentDefinitions.nora.system, /present conversation|near-term action/i, 'Nora must not remember temporary conversational state.');
assert.match(agentDefinitions.nora.system, /memory tool returned success/i, 'Nora must not claim persistence without a successful memory action.');
assert.match(agentDefinitions.vera.system, /source-of-truth discipline/i, 'Vera must verify source-of-truth discipline for planning work.');
assert.match(agentDefinitions.vera.system, /exhaustive allowlist/i, 'Vera must distinguish required-tool checks from exhaustive capability contracts.');

const planningContext = await buildAutomaticProjectContext('nora', [{
    role: 'user',
    content: 'Audit Dex and make an implementation plan for turning it into a Claude Code alternative.',
}]);
assert(planningContext.files.includes('Back/artifacts/README.md'), 'Planning requests must preload the durable project artifact index.');
assert.match(planningContext.content, /DEX_CLAUDE_CODE_PLAN\.md/, 'The planning preflight must expose the canonical Dex roadmap through the artifact index.');

// MCP action classification remains independently governed from the agent allowlist.
assert.equal(classifyMcpAction({ name: 'manage_email' }, { operation: 'search' }), 'read');
assert.equal(classifyMcpAction({ name: 'manage_email' }, { operation: 'send' }), 'dangerous');
assert.equal(classifyMcpAction({ name: 'manage_calendar' }, { operation: 'agenda' }), 'read');
assert.equal(classifyMcpAction({ name: 'manage_calendar' }, { operation: 'create' }), 'dangerous');
assert.equal(classifyMcpAction({ name: 'manage_drive' }, { operation: 'upload' }), 'write');
assert.equal(classifyMcpAction({ name: 'manage_drive' }, { operation: 'share' }), 'dangerous');
assert.equal(classifyMcpAction({ name: 'browser_click' }, { selector: '#submit' }), 'dangerous');
assert.equal(classifyMcpAction({ name: 'search_issues', annotations: { readOnlyHint: true } }, {}), 'read');

console.log('Agent capability contract passed (exhaustive allowlists + planning preflight).');
for (const agentId of Object.keys(agentDefinitions)) {
    console.log(`${agentId}: ${listTools(agentId).length} approved tools`);
}
