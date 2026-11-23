import "server-only";
import mongoose, { type ClientSession } from "mongoose";
import { connectToDatabase } from "./connect";

/**
 * Runs `fn` in a MongoDB transaction (Atlas replica set). The driver retries automatically on
 * transient errors and write conflicts, so `fn` must be safe to run more than once — read
 * fresh data inside it and pass `session` to every query.
 */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  await connectToDatabase();
  return mongoose.connection.transaction(fn);
}
