import { createPersistentMap } from './operationalStore.mjs';
import { installSkill, listSkills, readSkill, removeSkill } from './skillRegistry.mjs';
import { listAgentDefinitions } from './agentRegistry.mjs';

const settings = createPersistentMap('extension-settings-v1');
const allAgents = () => listAgentDefinitions().map(item => item.agentId);
const clone = value => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();

const scan = descriptor => {
    const text = String(descriptor || '');
    const findings = [
        ['critical', 'credential-exfiltration', /(?:print|send|upload|post).{0,80}(?:api[_ -]?key|token|secret|\.env)/i],
        ['critical', 'destructive-shell', /\brm\s+-rf\b|Remove-Item\s+.+-Recurse.+-Force/i],
        ['high', 'remote-shell-pipe', /(?:curl|wget).{0,160}\|\s*(?:sh|bash|zsh|powershell)/i],
        ['high', 'instruction-override', /ignore (?:all |the )?(?:previous|system|developer) instructions/i],
        ['medium', 'credential-access', /API_KEY|TOKEN|SECRET|credential|\.env\b/i],
        ['medium', 'package-install', /\b(?:npm|pip|pnpm|yarn)\s+install\b/i],
    ].filter(([, , pattern]) => pattern.test(text)).map(([severity, code]) => ({ severity, code }));
    const risk = findings.some(item => item.severity === 'critical') ? 'critical'
        : findings.some(item => item.severity === 'high') ? 'high'
            : findings.some(item => item.severity === 'medium') ? 'medium' : 'low';
    return { risk, findings, scannedAt: now() };
};

const toolContracts = detail => {
    const declared = [...String(detail.body || '').matchAll(/^-\s+([a-z][a-z0-9_]*)\s+::/gm)].map(match => match[1]);
    return [...new Set([...(detail.allowedTools || []), ...declared])];
};

export const listExtensions = async ({ agentId = '' } = {}) => {
    const skills = await listSkills();
    const records = [];
    for (const skill of skills) {
        const policy = settings.get(skill.name) || { enabledAgents: allAgents() };
        if (agentId && !policy.enabledAgents.includes(agentId)) continue;
        let security = { risk: skill.invalid ? 'critical' : 'unknown', findings: [], scannedAt: '' };
        if (!skill.invalid) {
            try { security = scan((await readSkill(skill.name)).descriptor); } catch (error) { security = { risk: 'critical', findings: [{ severity: 'critical', code: error.message }], scannedAt: now() }; }
        }
        records.push({ ...skill, enabledAgents: policy.enabledAgents, security, settingsUpdatedAt: policy.updatedAt || '' });
    }
    return records;
};

export const readExtension = async name => {
    const detail = await readSkill(name);
    const policy = settings.get(name) || { enabledAgents: allAgents() };
    const { listTools } = await import('./toolRegistry.mjs');
    const available = new Set(listTools().map(tool => tool.name));
    const requiredTools = toolContracts(detail);
    return { ...detail, requiredTools, missingTools: requiredTools.filter(tool => !available.has(tool)), enabledAgents: policy.enabledAgents, security: scan(detail.descriptor) };
};

export const updateExtension = ({ name, enabledAgents }) => {
    const known = new Set(allAgents());
    const normalized = [...new Set((enabledAgents || []).map(String).filter(agent => known.has(agent)))];
    const record = { name, enabledAgents: normalized, updatedAt: now() };
    settings.set(name, record);
    return clone(record);
};

export const installExtension = async input => {
    const result = await installSkill(input);
    const detail = await readSkill(result.name);
    const security = scan(detail.descriptor);
    if (security.risk === 'critical') {
        await removeSkill({ name: result.name, confirm: true });
        throw Object.assign(new Error(`Extension rejected by the safety scanner: ${security.findings.map(item => item.code).join(', ')}.`), { statusCode: 422, security });
    }
    settings.set(result.name, { name: result.name, enabledAgents: allAgents(), updatedAt: now() });
    return { ...result, security };
};

export const removeExtension = async ({ name, confirm }) => {
    const result = await removeSkill({ name, confirm });
    settings.delete(name);
    return result;
};

export const extensionEnabledForAgent = (name, agentId) => {
    const policy = settings.get(name);
    return !policy || policy.enabledAgents.includes(agentId);
};

export const extensionStatus = async () => {
    const extensions = await listExtensions();
    return { installed: extensions.length, highRisk: extensions.filter(item => ['high', 'critical'].includes(item.security.risk)).length };
};
