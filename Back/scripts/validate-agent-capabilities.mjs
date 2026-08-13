import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { listTools } from '../src/lib/toolRegistry.mjs';
import { agentDefinitions } from '../src/agents/agents.config.mjs';
import { classifyMcpAction } from '../src/lib/mcpClient.mjs';

const approved = {
    "nora": [
        "agent_create_temporary",
        "agent_get_config",
        "agent_promote",
        "agent_update_config",
        "artifact_publish",
        "artifact_read",
        "conversation_search",
        "current_time",
        "external_project_install",
        "external_project_list",
        "external_project_media_probe",
        "external_project_read",
        "fetch_url",
        "knowledge_note_promote",
        "knowledge_note_write",
        "knowledge_retention_directive",
        "knowledge_retention_scan",
        "knowledge_source_list",
        "knowledge_source_register",
        "knowledge_source_remove",
        "knowledge_source_update",
        "list_agents",
        "list_ollama_models",
        "memory_forget_fact",
        "memory_list",
        "memory_list_facts",
        "memory_read",
        "memory_remember_fact",
        "memory_search",
        "memory_update_fact",
        "memory_write",
        "monitor_list",
        "monitor_read",
        "monitor_run",
        "office_file_archive",
        "office_file_list",
        "office_file_read",
        "office_file_write",
        "openmontage_execute",
        "openmontage_preflight",
        "playwright_check_page",
        "playwright_inspect_page",
        "playwright_interact",
        "project_delete_file",
        "project_list_files",
        "project_publish_changes",
        "project_read_file",
        "project_run_check",
        "project_search_files",
        "project_write_file",
        "schedule_manage",
        "skill_install",
        "skill_list",
        "skill_read",
        "skill_read_resource",
        "skill_remove",
        "tool_pipeline",
        "web_search"
    ],
    "marco": [
        "artifact_publish",
        "artifact_read",
        "current_time",
        "fetch_url",
        "memory_list",
        "memory_read",
        "memory_search",
        "memory_write",
        "monitor_list",
        "monitor_read",
        "office_file_archive",
        "office_file_list",
        "office_file_read",
        "office_file_write",
        "skill_list",
        "skill_read",
        "skill_read_resource",
        "tool_pipeline",
        "web_search"
    ],
    "luma": [
        "artifact_publish",
        "artifact_read",
        "current_time",
        "external_project_list",
        "external_project_media_probe",
        "external_project_read",
        "fetch_url",
        "memory_list",
        "memory_read",
        "memory_search",
        "memory_write",
        "monitor_list",
        "monitor_read",
        "office_file_archive",
        "office_file_list",
        "office_file_read",
        "office_file_write",
        "openmontage_execute",
        "openmontage_preflight",
        "skill_list",
        "skill_read",
        "skill_read_resource",
        "tool_pipeline",
        "web_search"
    ],
    "dex": [
        "artifact_publish",
        "artifact_read",
        "current_time",
        "external_project_list",
        "external_project_media_probe",
        "external_project_read",
        "fetch_url",
        "list_ollama_models",
        "memory_list",
        "memory_read",
        "memory_search",
        "memory_write",
        "monitor_list",
        "monitor_read",
        "office_file_archive",
        "office_file_list",
        "office_file_read",
        "office_file_write",
        "openmontage_execute",
        "openmontage_preflight",
        "playwright_check_page",
        "playwright_inspect_page",
        "playwright_interact",
        "project_delete_file",
        "project_list_files",
        "project_read_file",
        "project_run_check",
        "project_search_files",
        "project_write_file",
        "skill_list",
        "skill_read",
        "skill_read_resource",
        "tool_pipeline",
        "web_search"
    ],
    "iris": [
        "artifact_publish",
        "artifact_read",
        "current_time",
        "external_project_list",
        "external_project_media_probe",
        "external_project_read",
        "fetch_url",
        "knowledge_note_write",
        "knowledge_retention_execute",
        "knowledge_retention_scan",
        "knowledge_source_list",
        "knowledge_source_register",
        "knowledge_source_update",
        "memory_list",
        "memory_list_facts",
        "memory_read",
        "memory_search",
        "memory_write",
        "monitor_list",
        "monitor_read",
        "monitor_run",
        "office_file_archive",
        "office_file_list",
        "office_file_read",
        "office_file_write",
        "playwright_check_page",
        "playwright_inspect_page",
        "project_list_files",
        "project_read_file",
        "project_search_files",
        "skill_list",
        "skill_read",
        "skill_read_resource",
        "tool_pipeline",
        "web_search"
    ],
    "vera": [
        "artifact_read",
        "current_time",
        "external_project_list",
        "external_project_media_probe",
        "external_project_read",
        "fetch_url",
        "memory_list",
        "memory_read",
        "memory_search",
        "memory_write",
        "monitor_list",
        "monitor_read",
        "office_file_list",
        "office_file_read",
        "openmontage_preflight",
        "playwright_check_page",
        "playwright_inspect_page",
        "playwright_interact",
        "project_list_files",
        "project_read_file",
        "project_run_check",
        "project_search_files",
        "skill_list",
        "skill_read",
        "skill_read_resource",
        "tool_pipeline",
        "web_search"
    ]
};
const names = agentId => listTools(agentId).map(tool => tool.name).sort();

assert.deepEqual(Object.keys(agentDefinitions).sort(), Object.keys(approved).sort(), 'Built-in AgentDefinitions changed.');
for (const [agentId, allowlist] of Object.entries(approved)) {
    assert.deepEqual(names(agentId), allowlist, `${agentId} capability authority changed; review and update the explicit allowlist.`);
}

const retired = new Set([
    'delegate_task', 'list_subagents', 'cancel_subagent', 'steer_subagent', 'acknowledge_subagent',
    'create_agent_job', 'get_agent_job', 'list_agent_jobs', 'retry_agent_job', 'cancel_agent_job',
    'stop_all_agent_jobs', 'clear_agent_jobs',
    'mcp_list_servers', 'mcp_list_tools', 'mcp_call',
]);
for (const agentId of Object.keys(approved)) {
    assert.equal(names(agentId).some(name => retired.has(name)), false, `${agentId} exposes a retired parallel runtime.`);
    for (const required of ['skill_list', 'skill_read', 'skill_read_resource', 'tool_pipeline']) {
        assert(names(agentId).includes(required), `${agentId} is missing ${required}.`);
    }
}
for (const noraOnly of ['conversation_search', 'schedule_manage', 'skill_install', 'skill_remove', 'agent_update_config']) {
    assert(names('nora').includes(noraOnly), `Nora must own ${noraOnly}.`);
    for (const agentId of ['marco', 'luma', 'dex', 'iris', 'vera']) {
        assert(!names(agentId).includes(noraOnly), `${agentId} must not own ${noraOnly}.`);
    }
}
for (const forbidden of ['project_write_file', 'project_delete_file', 'office_file_write', 'office_file_archive', 'artifact_publish']) {
    assert(!names('vera').includes(forbidden), `Vera must remain independent and cannot receive ${forbidden}.`);
}

assert.match(agentDefinitions.nora.system, /Request may start zero, one, or several Jobs/i);
assert.match(agentDefinitions.nora.system, /exact ordered tool plan/i);
assert.match(agentDefinitions.nora.system, /AgentInstance executes one Task at a time/i);
assert.match(agentDefinitions.nora.system, /Temporary specialists inherit/i);

const processSource = await readFile(new URL('../src/lib/processEngine.mjs', import.meta.url), 'utf8');
const chatSource = await readFile(new URL('../../Front/src/pages/ChatPage.jsx', import.meta.url), 'utf8');
const controllerSource = await readFile(new URL('../src/controllers/OfficeController.mjs', import.meta.url), 'utf8');
assert.match(processSource, /Processes are reusable definitions; jobs are[\s\S]*Tasks, attempts, and agent instances/i);
assert.match(processSource, /TOOLS PLANNED IN THIS EXACT ORDER/);
assert.match(processSource, /deleteJobsForMessages/);
assert.match(processSource, /anonymous-operational-aggregates/);
assert.match(chatSource, /Chats save automatically/);
assert.match(chatSource, /Auto-saved/);
assert.doesNotMatch(chatSource, /temporary chat|expires after 7 days/i);
assert.match(controllerSource, /cancelJobsForConversation/);
assert.match(controllerSource, /deleteJobsForConversation/);

assert.equal(classifyMcpAction({ name: 'manage_email' }, { operation: 'search' }), 'read');
assert.equal(classifyMcpAction({ name: 'manage_email' }, { operation: 'send' }), 'dangerous');
assert.equal(classifyMcpAction({ name: 'manage_calendar' }, { operation: 'create' }), 'dangerous');
assert.equal(classifyMcpAction({ name: 'manage_drive' }, { operation: 'upload' }), 'write');
assert.equal(classifyMcpAction({ name: 'browser_click' }, { selector: '#submit' }), 'dangerous');

console.log('Agent capability contract passed: one durable process runtime, explicit authority, Nora orchestration, and independent Vera verification.');
