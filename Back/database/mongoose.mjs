import mongoose from 'mongoose';

let connecting = null;

const connect = async () => {
    if (mongoose.connection.readyState === 1) return mongoose;
    if (connecting) return connecting;

    const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/carlos-office';
    connecting = mongoose.connect(uri, {
        serverSelectionTimeoutMS: 5000,
    }).finally(() => {
        connecting = null;
    });

    return connecting;
};

export default {
    mongoose,
    connect,
};
