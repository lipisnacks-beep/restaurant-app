import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI as string;

if (!MONGODB_URI) {
  throw new Error('Please define MONGODB_URI in .env');
}

// Cache the connection on the global object to avoid reconnects in dev hot reload.
type MongooseCache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
const globalCache = global as unknown as { mongoose?: MongooseCache };
if (!globalCache.mongoose) {
  globalCache.mongoose = { conn: null, promise: null };
}
const cached = globalCache.mongoose;

async function dbConnect(): Promise<typeof mongoose> {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    const opts: mongoose.ConnectOptions = {
      bufferCommands: false,
    };
    cached.promise = mongoose.connect(MONGODB_URI, opts);
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

export default dbConnect;
