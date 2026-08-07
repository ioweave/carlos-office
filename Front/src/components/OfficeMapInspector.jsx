import { IconBriefcase2, IconMessageCircle, IconX } from '@tabler/icons-react';
import StatusBadge from './StatusBadge';

const ACTIVE_STATUSES = new Set(['queued', 'running', 'qc_review']);

const formatDate = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
};
const statusLabel = value => String(value || 'unknown').replaceAll('_', ' ');
const modelLabel = model => model?.model
    ? `${model.provider || 'model'} · ${model.model}${model.fallbackUsed ? ' · fallback' : ''}`
    : 'Not recorded';
const toneForStatus = status => ({
    queued: 'neutral', running: 'warning', qc_review: 'warning', awaiting_approval: 'warning',
    completed: 'success', failed: 'danger', cancelled: 'neutral',
}[status] || 'neutral');

export default function OfficeMapInspector({
    node,
    detail,
    loading,
    tab,
    setTab,
    position,
    inspectorRef,
    onStartDrag,
    onClose,
    data,
    topology,
    agentColors,
    onSelectNode,
    onOpenConversation,
}) {
    if (!node || !position) return null;

    const activeJobs = data.jobs?.filter(job => ACTIVE_STATUSES.has(job.status)) || [];
    const agentActivity = node.kind === 'agent' ? {
        chats: data.conversations?.filter(item => item.agentId === node.agentId) || [],
        jobs: data.jobs?.filter(item => item.assignedAgent === node.agentId || (node.agentId === 'vera' && item.qcAgent === 'vera')) || [],
    } : null;
    const activeExecution = node.kind === 'job'
        ? data.runner?.active?.find(item => item.jobId === node.data.jobId)
        : null;
    const job = node.kind === 'job' ? (detail || node.data) : null;
    const conversation = node.kind === 'conversation' ? detail : null;

    return (
        <section
            ref={inspectorRef}
            className="map-inspector-card"
            style={{ left: position.x, top: position.y, '--inspector-accent': node.color }}
            aria-label={`${node.title} inspector`}
        >
            <header className="map-inspector-header" onPointerDown={onStartDrag}>
                <div className="map-inspector-identity">
                    <span className="map-inspector-dot" />
                    <div><small>{node.kind}</small><strong>{node.title}</strong><span>{node.subtitle}</span></div>
                </div>
                <button type="button" onPointerDown={event => event.stopPropagation()} onClick={onClose} aria-label="Close inspector"><IconX size={17} /></button>
            </header>

            <div className="map-inspector-tabs" role="tablist">
                <button type="button" className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>Activity</button>
                <button type="button" className={tab === 'details' ? 'active' : ''} onClick={() => setTab('details')}>Details</button>
            </div>

            <div className="map-inspector-body">
                {loading && <div className="inspector-loading"><span className="loader" /> Refreshing record…</div>}

                {node.kind === 'agent' && agentActivity && tab === 'activity' && (
                    <div className="inspector-stack">
                        <div className="inspector-stat-row">
                            <div><span>Chats</span><strong>{agentActivity.chats.length}</strong></div>
                            <div><span>Jobs</span><strong>{agentActivity.jobs.length}</strong></div>
                            <div><span>Status</span><strong>{activeJobs.some(jobItem => jobItem.assignedAgent === node.agentId || (node.agentId === 'vera' && jobItem.status === 'qc_review')) ? 'Working' : 'Ready'}</strong></div>
                        </div>
                        <section className="inspector-section">
                            <h3>Recent activity</h3>
                            <div className="inspector-record-list">
                                {[...agentActivity.jobs.map(item => ({ ...item, _kind: 'job' })), ...agentActivity.chats.map(item => ({ ...item, _kind: 'conversation' }))]
                                    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
                                    .slice(0, 12)
                                    .map(item => {
                                        const nextNode = topology.nodes.find(candidate => candidate.id === `${item._kind}:${item.jobId || item.conversationId}`);
                                        return (
                                            <button type="button" key={item.jobId || item.conversationId} onClick={() => onSelectNode(nextNode)}>
                                                {item._kind === 'job' ? <IconBriefcase2 size={15} /> : <IconMessageCircle size={15} />}
                                                <span><strong>{item.title}</strong><small>{item._kind === 'job' ? statusLabel(item.status) : `${item.messageCount} messages`}</small></span>
                                            </button>
                                        );
                                    })}
                            </div>
                        </section>
                    </div>
                )}

                {node.kind === 'agent' && tab === 'details' && (
                    <dl className="inspector-definition-list">
                        <div><dt>Role</dt><dd>{node.data.role}</dd></div>
                        <div><dt>Provider</dt><dd>{node.data.provider}</dd></div>
                        <div><dt>Primary model</dt><dd>{node.data.model}</dd></div>
                        <div><dt>Fallback</dt><dd>{node.data.fallback?.enabled ? node.data.fallback.model : 'Disabled'}</dd></div>
                        <div><dt>Tool rounds</dt><dd>{node.data.maxToolRounds}</dd></div>
                    </dl>
                )}

                {node.kind === 'conversation' && tab === 'activity' && (
                    <div className="inspector-stack">
                        <div className="inspector-note">Visible transcript, model metadata, and tool activity. Hidden model chain-of-thought is not exposed.</div>
                        <div className="conversation-trace">
                            {(conversation?.messages || []).map((message, index) => (
                                <article key={`${message.createdAt}-${index}`} className={`trace-message ${message.role}`}>
                                    <div className="trace-message-meta">
                                        <strong>{message.role === 'user' ? 'Carlos' : node.data.agentId}</strong>
                                        <span>{formatDate(message.createdAt)}</span>
                                    </div>
                                    {message.model && <small className="trace-model">{modelLabel(message.model)}</small>}
                                    <p>{message.content}</p>
                                    {!!message.toolEvents?.length && (
                                        <details><summary>{message.toolEvents.length} tool event{message.toolEvents.length === 1 ? '' : 's'}</summary>
                                            {message.toolEvents.map((tool, toolIndex) => <pre key={`${tool.name}-${toolIndex}`}>{JSON.stringify(tool, null, 2)}</pre>)}
                                        </details>
                                    )}
                                </article>
                            ))}
                            {!conversation?.messages?.length && <p className="muted-copy">No transcript messages are available yet.</p>}
                        </div>
                        <button type="button" className="primary-button inspector-open-button" onClick={() => {
                            onClose();
                            onOpenConversation?.(node.data.conversationId);
                        }}><IconMessageCircle size={16} /> Open full conversation</button>
                    </div>
                )}

                {node.kind === 'conversation' && tab === 'details' && (
                    <dl className="inspector-definition-list">
                        <div><dt>Agent</dt><dd>{node.data.agentId}</dd></div>
                        <div><dt>Messages</dt><dd>{node.data.messageCount}</dd></div>
                        <div><dt>Attachments</dt><dd>{node.data.attachmentCount || 0}</dd></div>
                        <div><dt>Updated</dt><dd>{formatDate(node.data.updatedAt)}</dd></div>
                        <div><dt>Markdown file</dt><dd>{node.data.path}</dd></div>
                    </dl>
                )}

                {node.kind === 'job' && tab === 'activity' && job && (
                    <div className="inspector-stack">
                        <div className="inspector-note">Visible execution trace: routing, model metadata, tool calls, deliverables, and Vera feedback. Hidden chain-of-thought is not exposed.</div>
                        <div className="job-live-strip">
                            <StatusBadge tone={toneForStatus(job.status)}>{statusLabel(job.status)}</StatusBadge>
                            <span>{activeExecution?.stage || statusLabel(job.status)}</span>
                            <span>Iteration {job.currentIteration || 0}/{job.maxIterations || 2}</span>
                        </div>
                        <section className="inspector-section">
                            <h3>Agent communication</h3>
                            <div className="agent-message-stream">
                                {(job.messages || []).map(message => (
                                    <article key={message.messageId}>
                                        <div className="agent-route">
                                            <span style={{ '--agent-color': agentColors[message.from] || '#94a3b8' }}>{message.from}</span>
                                            <i>→</i>
                                            <span style={{ '--agent-color': agentColors[message.to] || '#94a3b8' }}>{message.to || 'office'}</span>
                                            <small>{formatDate(message.createdAt)}</small>
                                        </div>
                                        <strong>{statusLabel(message.type)}</strong>
                                        <p>{message.content}</p>
                                    </article>
                                ))}
                                {!job.messages?.length && <p className="muted-copy">No inter-agent messages recorded yet.</p>}
                            </div>
                        </section>
                        <section className="inspector-section">
                            <h3>Model execution</h3>
                            <div className="attempt-trace-list">
                                {(job.attempts || []).map(attempt => (
                                    <details key={attempt.iteration} open={attempt.iteration === job.currentIteration}>
                                        <summary>Iteration {attempt.iteration} · {attempt.qcVerdict} · {attempt.qcScore}/100</summary>
                                        <div className="attempt-models">
                                            <span>Worker: {modelLabel(attempt.workerModel)}</span>
                                            <span>Vera: {modelLabel(attempt.qcModel)}</span>
                                        </div>
                                        <h4>Worker deliverable</h4>
                                        <pre>{attempt.workerOutput}</pre>
                                        <h4>Vera review</h4>
                                        <p>{attempt.qcSummary || attempt.qcFeedback || 'No review text recorded.'}</p>
                                        {!!attempt.missing?.length && <ul>{attempt.missing.map(item => <li key={item}>{item}</li>)}</ul>}
                                        {!!attempt.workerToolEvents?.length && <details><summary>Worker tool activity</summary><pre>{JSON.stringify(attempt.workerToolEvents, null, 2)}</pre></details>}
                                    </details>
                                ))}
                                {!job.attempts?.length && <p className="muted-copy">The worker has not completed an iteration yet.</p>}
                            </div>
                        </section>
                    </div>
                )}

                {node.kind === 'job' && tab === 'details' && job && (
                    <div className="inspector-stack">
                        <section className="inspector-section"><h3>Expected result</h3><p>{job.expectedResult || 'Not specified.'}</p></section>
                        <section className="inspector-section"><h3>Acceptance criteria</h3><ul>{(job.acceptanceCriteria || []).map(item => <li key={item}>{item}</li>)}</ul></section>
                        {job.result && <section className="inspector-section"><h3>Current result</h3><pre className="inspector-result">{job.result}</pre></section>}
                        <dl className="inspector-definition-list">
                            <div><dt>Worker</dt><dd>{job.assignedAgent}</dd></div>
                            <div><dt>QC agent</dt><dd>{job.qcAgent}</dd></div>
                            <div><dt>Priority</dt><dd>{job.priority}</dd></div>
                            <div><dt>QC score</dt><dd>{job.qcScore || 0}/100</dd></div>
                            <div><dt>Markdown file</dt><dd>{job.path}</dd></div>
                        </dl>
                    </div>
                )}
            </div>
        </section>
    );
}
