import { getOperationalDatabase } from './operationalStore.mjs';

const database = getOperationalDatabase();
database.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS conversation_fts USING fts5(
        conversation_id UNINDEXED,
        message_id UNINDEXED,
        title,
        agent_id UNINDEXED,
        role UNINDEXED,
        content,
        created_at UNINDEXED,
        tokenize = 'unicode61 remove_diacritics 2'
    );
`);

const messageText = message => {
    if (typeof message?.content === 'string') return message.content;
    if (!Array.isArray(message?.content)) return String(message?.content || '');
    return message.content.filter(part => part?.type === 'text').map(part => part.text || '').join('\n');
};
const queryExpression = value => {
    const tokens = String(value || '').normalize('NFKC').match(/[\p{L}\p{N}_-]{2,}/gu) || [];
    return [...new Set(tokens)].slice(0, 16).map(token => `"${token.replace(/"/g, '""')}"`).join(' AND ');
};

export const indexConversation = conversation => {
    if (!conversation?.persisted || !conversation.conversationId) return { indexed: false, reason: 'not-persisted' };
    const remove = database.prepare('DELETE FROM conversation_fts WHERE conversation_id = ?');
    const insert = database.prepare(`
        INSERT INTO conversation_fts (
            conversation_id, message_id, title, agent_id, role, content, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    database.exec('BEGIN IMMEDIATE');
    try {
        remove.run(conversation.conversationId);
        (conversation.messages || []).forEach((message, index) => insert.run(
            conversation.conversationId,
            `${conversation.conversationId}:${index}`,
            conversation.title || 'Conversation',
            conversation.agentId || 'nora',
            message.role || '',
            messageText(message).slice(0, 250_000),
            message.createdAt || conversation.updatedAt || new Date().toISOString(),
        ));
        database.exec('COMMIT');
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
    return { indexed: true, messages: conversation.messages?.length || 0 };
};

export const removeConversationFromSearch = conversationId => {
    const result = database.prepare('DELETE FROM conversation_fts WHERE conversation_id = ?').run(String(conversationId || ''));
    return { removed: Number(result.changes || 0) };
};

export const searchConversationHistory = ({ query, limit = 12, agentId = '' } = {}) => {
    const expression = queryExpression(query);
    if (!expression) return [];
    const bounded = Math.max(1, Math.min(Number(limit) || 12, 50));
    const rows = database.prepare(`
        SELECT conversation_id, title, agent_id, role, created_at,
               snippet(conversation_fts, 5, '⟦', '⟧', ' … ', 28) AS excerpt,
               bm25(conversation_fts, 3.0, 0.0, 2.0, 0.0, 0.0, 1.0, 0.0) AS rank
        FROM conversation_fts
        WHERE conversation_fts MATCH ?
          AND (? = '' OR agent_id = ?)
        ORDER BY rank ASC, created_at DESC
        LIMIT ?
    `).all(expression, String(agentId || ''), String(agentId || ''), bounded * 3);
    const seen = new Set();
    return rows.filter(row => {
        const key = `${row.conversation_id}:${row.excerpt}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, bounded).map(row => ({
        conversationId: row.conversation_id,
        title: row.title,
        agentId: row.agent_id,
        role: row.role,
        createdAt: row.created_at,
        excerpt: row.excerpt,
        score: Math.max(0, -Number(row.rank || 0)),
    }));
};

export const warmConversationSearch = () => {
    setTimeout(async () => {
        try {
            const { listConversations, getConversation } = await import('./officeStore.mjs');
            const records = await listConversations({ limit: 500 });
            for (const item of records) {
                const conversation = await getConversation(item.conversationId);
                if (conversation) indexConversation({ ...conversation, persisted: true });
            }
        } catch (error) {
            console.error('[conversations] Could not warm FTS search:', error.message);
        }
    }, 400);
};

export const conversationSearchStatus = () => ({
    messages: Number(database.prepare('SELECT COUNT(*) AS count FROM conversation_fts').get().count),
    conversations: Number(database.prepare('SELECT COUNT(DISTINCT conversation_id) AS count FROM conversation_fts').get().count),
    automaticMemoryInjection: false,
});
