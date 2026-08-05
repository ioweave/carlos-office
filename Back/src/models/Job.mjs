import mongoose from 'mongoose';

const schema = new mongoose.Schema({
    jobId: { type: String, required: true, unique: true, index: true },
    createdBy: { type: String, default: 'nora' },
    assignedAgent: { type: String, required: true },
    title: { type: String, required: true },
    instructions: { type: String, required: true },
    priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
    status: {
        type: String,
        enum: ['queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled'],
        default: 'queued',
    },
    providerSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    error: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.models.Job || mongoose.model('Job', schema);
