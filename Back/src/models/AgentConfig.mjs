import mongoose from 'mongoose';

const fallbackSchema = new mongoose.Schema({
    enabled: { type: Boolean, default: false },
    provider: { type: String, default: 'openai' },
    model: { type: String, default: '' },
    baseUrl: { type: String, default: '' },
}, { _id: false });

const schema = new mongoose.Schema({
    agentId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    role: { type: String, required: true },
    provider: { type: String, default: 'ollama' },
    model: { type: String, default: '' },
    baseUrl: { type: String, default: '' },
    temperature: { type: Number, default: 0.2 },
    maxToolRounds: { type: Number, default: 4 },
    enabled: { type: Boolean, default: true },
    fallback: { type: fallbackSchema, default: () => ({}) },
}, { timestamps: true });

export default mongoose.models.AgentConfig || mongoose.model('AgentConfig', schema);
