import { agentDefinitions, defaultAgentConfig } from '../agents/agents.config.mjs';
import { getAgentConfig, saveAgentConfig } from './officeStore.mjs';

export const migrateAgentRuntimeConfigs = async () => {
    const migrated = [];
    for (const agentId of Object.keys(agentDefinitions)) {
        const defaults = defaultAgentConfig(agentId);
        const current = await getAgentConfig(agentId, defaults);
        if (Number(current.configVersion || 0) >= Number(defaults.configVersion || 0)) continue;
        const next = await saveAgentConfig(agentId, {
            name: defaults.name,
            role: defaults.role,
            maxToolRounds: Math.max(Number(current.maxToolRounds || 0), Number(defaults.maxToolRounds || 0)),
            configVersion: defaults.configVersion,
        }, defaults);
        migrated.push({ agentId, from: current.configVersion || 0, to: next.configVersion, maxToolRounds: next.maxToolRounds });
    }
    return migrated;
};
