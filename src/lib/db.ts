import mongoose from 'mongoose';

// Read at call-time, not import-time. Importing this module must NEVER throw —
// Next.js evaluates API-route module graphs during build ("collect page data")
// where MONGODB_URI is typically unset, and a top-level throw here breaks the
// whole build. The actual URI check happens inside dbConnect() so only a real
// connection attempt (at request time) can fail.

// Cache the connection on the global object to avoid reconnects in dev hot reload.
type MongooseCache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
const globalCache = global as unknown as { mongoose?: MongooseCache };
if (!globalCache.mongoose) {
  globalCache.mongoose = { conn: null, promise: null };
}
const cached = globalCache.mongoose;

async function dbConnect(): Promise<typeof mongoose> {
  if (cached.conn) return cached.conn;
  const MONGODB_URI = process.env.MONGODB_URI as string;
  if (!MONGODB_URI) {
    // The most common deploy mistake: Vercel/production does NOT load .env
    // files — env vars must be set in the project settings. Throw a clear,
    // distinct error so route handlers can map it to an actionable 503
    // instead of a bare, empty 500.
    throw new Error('MONGODB_URI is not configured. Set it in your environment (Vercel: Project Settings → Environment Variables; locally: a .env file).');
  }
  if (!cached.promise) {
    const opts: mongoose.ConnectOptions = {
      bufferCommands: false,
    };
    cached.promise = mongoose.connect(MONGODB_URI, opts);
  }
  try {
    cached.conn = await cached.promise;
  } catch (err) {
    // A failed connection attempt should not poison the cache — allow a retry
    // on the next request instead of permanently rejecting.
    cached.promise = null;
    throw err;
  }
  return cached.conn;
}

export default dbConnect;
