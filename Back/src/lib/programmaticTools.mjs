const SAFE_PIPELINE_TOOLS = new Set([
    'memory_search', 'memory_read', 'memory_list', 'conversation_search',
    'web_search', 'fetch_url', 'project_list_files', 'project_read_file', 'project_search_files',
    'artifact_read', 'skill_list', 'skill_read', 'skill_read_resource',
    'office_file_list', 'office_file_read', 'current_time', 'list_agents',
    'external_project_list', 'external_project_read', 'external_project_media_probe', 'openmontage_preflight',
    'monitor_list', 'monitor_read',
]);

const valueAt = (value, path) => String(path || '').split('.').filter(Boolean).reduce((current, key) => current?.[key], value);
const resolveReferences = (value, results) => {
    if (Array.isArray(value)) return value.map(item => resolveReferences(item, results));
    if (!value || typeof value !== 'object') return value;
    if (Object.keys(value).length === 1 && typeof value.$from === 'string') {
        const [stepId, ...path] = value.$from.split('.');
        if (!results.has(stepId)) throw new Error(`Pipeline reference requires unfinished step ${stepId}.`);
        return valueAt(results.get(stepId), path.join('.'));
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveReferences(item, results)]));
};
const clipValue = (value, maxChars = 20_000) => {
    const source = JSON.stringify(value);
    if (source.length <= maxChars) return value;
    return { truncated: true, totalChars: source.length, preview: source.slice(0, maxChars) };
};

export const executeToolPipeline = async (agentId, input = {}, { executeTool } = {}) => {
    const steps = Array.isArray(input.steps) ? input.steps.slice(0, 20) : [];
    if (steps.length < 2) throw Object.assign(new Error('A tool pipeline requires at least two steps.'), { statusCode: 400 });
    const ids = new Set();
    steps.forEach((step, index) => {
        const id = String(step.id || `step${index + 1}`);
        if (!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(id) || ids.has(id)) throw Object.assign(new Error(`Invalid or duplicate pipeline step ID: ${id}.`), { statusCode: 400 });
        step.id = id;
        if (!SAFE_PIPELINE_TOOLS.has(step.tool)) throw Object.assign(new Error(`Tool ${step.tool} is not allowed in programmatic pipelines.`), { statusCode: 403 });
        ids.add(id);
    });
    steps.forEach(step => (step.dependsOn || []).forEach(dependency => {
        if (!ids.has(dependency) || dependency === step.id) throw Object.assign(new Error(`Invalid dependency ${dependency} for ${step.id}.`), { statusCode: 400 });
    }));

    const results = new Map();
    const summaries = [];
    const pending = new Map(steps.map(step => [step.id, step]));
    const concurrency = Math.max(1, Math.min(Number(input.concurrency || 4), 4));
    const timeoutMs = Math.max(1_000, Math.min(Number(input.timeoutMs || 120_000), 300_000));
    const startedAt = Date.now();

    while (pending.size) {
        if (Date.now() - startedAt > timeoutMs) throw Object.assign(new Error('Programmatic tool pipeline timed out.'), { statusCode: 504 });
        const ready = [...pending.values()].filter(step => (step.dependsOn || []).every(id => results.has(id))).slice(0, concurrency);
        if (!ready.length) throw Object.assign(new Error('Pipeline dependencies contain a cycle.'), { statusCode: 400 });
        await Promise.all(ready.map(async step => {
            const stepStartedAt = Date.now();
            try {
                const args = resolveReferences(step.args || {}, results);
                const result = await executeTool(agentId, step.tool, args);
                results.set(step.id, result);
                summaries.push({ id: step.id, tool: step.tool, status: 'completed', durationMs: Date.now() - stepStartedAt });
            } catch (error) {
                if (!step.continueOnError) throw error;
                const result = { error: error.message || 'Tool failed.', failed: true };
                results.set(step.id, result);
                summaries.push({ id: step.id, tool: step.tool, status: 'failed', error: result.error, durationMs: Date.now() - stepStartedAt });
            } finally {
                pending.delete(step.id);
            }
        }));
    }

    const selectors = Array.isArray(input.outputs) ? input.outputs.slice(0, 20) : [];
    const outputs = selectors.length
        ? Object.fromEntries(selectors.map(selector => {
            const source = results.get(selector.step);
            if (source === undefined) throw Object.assign(new Error(`Unknown output step ${selector.step}.`), { statusCode: 400 });
            return [String(selector.as || selector.step), clipValue(selector.path ? valueAt(source, selector.path) : source, Number(selector.maxChars || 20_000))];
        }))
        : { result: clipValue(results.get(steps.at(-1).id), 20_000) };
    return {
        status: 'completed',
        steps: summaries,
        outputs,
        intermediateResultsSuppressed: Math.max(0, steps.length - Object.keys(outputs).length),
        durationMs: Date.now() - startedAt,
    };
};

export const programmaticToolStatus = () => ({ allowedTools: [...SAFE_PIPELINE_TOOLS], maxSteps: 20, maxConcurrency: 4, arbitraryCode: false });
