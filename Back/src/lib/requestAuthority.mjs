const text = value => String(value || '').trim();

const EXPLICIT_DELETE = /\b(delete|remove|purge|erase|discard|clean(?:up)?|clear)\b/i;
const EXPLICIT_PUBLISH = /\b(push|commit(?:\s+and\s+push)?|publish\s+(?:it|this|changes|to\s+(?:git|github))|merge\s+(?:it|this|changes)|open\s+(?:a\s+)?pr)\b/i;
const EXPLICIT_DEPENDENCY = /\b(install|add|upgrade|update|implement|build|fix|repair|create)\b/i;
const NEGATED_DELETE = /\b(?:do\s+not|don't|without)\s+(?:delete|remove|purge|erase|discard|clean|clear)\b/i;
const NEGATED_PUBLISH = /\b(?:do\s+not|don't|without)\s+(?:commit|push|publish|merge|open\s+(?:a\s+)?pr)\b/i;
const EXPLICIT_EXTERNAL_WRITE = /\b(?:create|update|edit|modify|upload|move|share|label|schedule)\b.{0,80}\b(?:email|calendar|drive|document|sheet|slack|discord|telegram|whatsapp|connected|external)\b/i;
const EXPLICIT_EXTERNAL_MESSAGE = /\b(?:send|reply|forward|post|message|notify|deliver)\b/i;
const EXPLICIT_SKILL = /\b(?:install|remove|uninstall|replace|update)\b.{0,50}\b(?:skill|extension|plugin)\b/i;
const EXPLICIT_SCHEDULE = /\b(?:create|update|delete|remove|schedule|automate|remind)\b.{0,80}\b(?:schedule|automation|reminder|cron|recurring)\b/i;
const EXPLICIT_CREDENTIAL = /\b(?:add|change|rotate|remove|revoke|update)\b.{0,50}\b(?:credential|api key|token|password|access)\b/i;

export const createRequestAuthority = objective => {
    const request = text(objective);
    return {
        version: 'carlos-request-authority/1.0',
        source: 'authenticated-local-chat',
        objective: request.slice(0, 8_000),
        localProjectMutation: Boolean(request),
        dependencyInstall: EXPLICIT_DEPENDENCY.test(request),
        projectDelete: EXPLICIT_DELETE.test(request) && !NEGATED_DELETE.test(request),
        gitPublish: EXPLICIT_PUBLISH.test(request) && !NEGATED_PUBLISH.test(request),
        externalWrite: EXPLICIT_EXTERNAL_WRITE.test(request),
        externalMessage: EXPLICIT_EXTERNAL_MESSAGE.test(request),
        skillAdmin: EXPLICIT_SKILL.test(request),
        scheduleAdmin: EXPLICIT_SCHEDULE.test(request),
        credentials: EXPLICIT_CREDENTIAL.test(request),
    };
};

export const requestAuthorityManifest = authority => {
    if (!authority?.objective) return '';
    return [
        'AUTHORITATIVE REQUEST AUTHORIZATION',
        'Carlos issued the latest request through his authenticated local Carlos Office chat.',
        'That request is the authorization for every necessary, scoped, reversible local action required to complete it. Do not ask Carlos to approve the same action again.',
        'Stay inside the requested outcome. Authorization never permits unrelated work, credential exposure, or broader remote/destructive actions.',
        `Local project mutation authorized: ${authority.localProjectMutation ? 'yes' : 'no'}.`,
        `Dependency installation authorized when necessary: ${authority.dependencyInstall ? 'yes' : 'no'}.`,
        `Project deletion authorized only when explicitly requested: ${authority.projectDelete ? 'yes' : 'no'}.`,
        `Git commit/push authorized: ${authority.gitPublish ? 'yes' : 'no'}.`,
        `Connected-service writes authorized: ${authority.externalWrite ? 'yes' : 'no'}.`,
        `External message delivery authorized: ${authority.externalMessage ? 'yes' : 'no'}.`,
        `Skill/extension administration authorized: ${authority.skillAdmin ? 'yes' : 'no'}.`,
        `Schedule administration authorized: ${authority.scheduleAdmin ? 'yes' : 'no'}.`,
        'If your own manifest lacks a required local capability, route one shared job to Dex, who has scoped project-write and check tools. Do not convert an available delegation route into a refusal.',
        'If the requested capability truly does not exist, use the same Dex job to add the smallest scoped tool, validate it, continue the original task, and report one final outcome.',
    ].join('\n');
};
