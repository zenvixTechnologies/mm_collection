import "server-only";
import mongoose from "mongoose";
import { getEnv } from "@/server/config/env";
import { AppError } from "@/server/http/errors";
import { logger, serializeError } from "@/server/utils/logger";

/**
 * Shared Mongoose connection for route handlers, server components, scripts and cron jobs.
 *
 * - Cached on globalThis: survives Next.js hot reloads in development and is reused by warm
 *   serverless invocations on Vercel, so each instance holds one small pool.
 * - Command buffering is off: if the database is unreachable a query fails fast (→ 503) instead
 *   of hanging until the function times out.
 */

mongoose.set("strictQuery", true);
mongoose.set("bufferCommands", false);

interface ConnectionCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

const globalForMongoose = globalThis as typeof globalThis & { __mmMongoose?: ConnectionCache };
const cache: ConnectionCache = (globalForMongoose.__mmMongoose ??= { conn: null, promise: null });

export function connectionOptions(env: { MONGODB_DB_NAME?: string; MONGODB_MAX_POOL_SIZE: number }): mongoose.ConnectOptions {
  return {
    dbName: env.MONGODB_DB_NAME,
    appName: "mm-collections",
    bufferCommands: false,
    maxPoolSize: env.MONGODB_MAX_POOL_SIZE,
    minPoolSize: 0,
    // Close idle sockets so frozen serverless instances don't hold Atlas connections for long.
    maxIdleTimeMS: 60_000,
    serverSelectionTimeoutMS: 8_000,
    connectTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
    retryWrites: true,
    // Production builds indexes with an explicit sync script (added with the models in Phase 1),
    // not on every cold start.
    autoIndex: process.env.NODE_ENV !== "production",
  };
}

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (cache.conn && mongoose.connection.readyState === 1) return cache.conn;

  if (!cache.promise) {
    const env = getEnv("database"); // throws ConfigError (→ 503) if MONGODB_URI is missing
    cache.promise = mongoose.connect(env.MONGODB_URI, connectionOptions(env));
  }

  try {
    cache.conn = await cache.promise;
    return cache.conn;
  } catch (err) {
    // Let the next request retry instead of caching the failure forever.
    cache.promise = null;
    cache.conn = null;
    logger.error("db.connect_failed", { error: serializeError(err) });
    throw new AppError(503, "DATABASE_UNAVAILABLE", "We're having trouble reaching our servers. Please try again shortly.", {
      cause: err,
    });
  }
}

/** Round-trip check used by the health endpoint. */
export async function pingDatabase(): Promise<boolean> {
  const { connection } = await connectToDatabase();
  const db = connection.db;
  if (!db) return false;
  const res = await db.admin().command({ ping: 1 });
  return res.ok === 1;
}

/** Scripts and tests only — route handlers keep the pooled connection open. */
export async function disconnectFromDatabase() {
  cache.promise = null;
  cache.conn = null;
  await mongoose.disconnect();
}
