import mongoose from 'mongoose';

const schema = new mongoose.Schema({
    conversationId: { type: String, required: true, unique: true, index: true },
    agentId: { type: String, required: true, default: 'nora' },
    title: { type: String, default: 'New conversation' },
    messages: { type: [mongoose.Schema.Types.Mixed], default: [] },
}, { timestamps: true });

export default mongoose.models.Conversation || mongoose.model('Conversation', schema);
