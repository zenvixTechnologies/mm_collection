import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/server/config/env";
import { ConfigError } from "@/server/http/errors";
import { connectToDatabase, connectionOptions, disconnectFromDatabase, pingDatabase } from "./connect";

/** Integration test against a throwaway in-memory MongoDB (downloaded on first run). */
let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
}, 180_000);

afterAll(async () => {
  await disconnectFromDatabase();
  await mongo?.stop();
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("connectToDatabase", () => {
  it("fails with a ConfigError when MONGODB_URI is missing", async () => {
    vi.stubEnv("MONGODB_URI", "");
    resetEnvCache();
    await expect(connectToDatabase()).rejects.toBeInstanceOf(ConfigError);
  });

  it("connects, pings and reuses the cached connection", async () => {
    vi.stubEnv("MONGODB_URI", mongo.getUri());
    vi.stubEnv("MONGODB_DB_NAME", "mm-test");
    resetEnvCache();

    const [a, b] = await Promise.all([connectToDatabase(), connectToDatabase()]);
    expect(a).toBe(b);
    expect(mongoose.connection.readyState).toBe(1);
    expect(mongoose.connection.name).toBe("mm-test");
    expect(await pingDatabase()).toBe(true);
    expect(await connectToDatabase()).toBe(a);
  });

  it("disables command buffering so queries fail fast when disconnected", async () => {
    await disconnectFromDatabase();
    const Probe = mongoose.models.Probe ?? mongoose.model("Probe", new mongoose.Schema({ n: Number }));
    await expect(Probe.findOne().exec()).rejects.toThrow();
  });

  it("reports an unreachable database as DATABASE_UNAVAILABLE and retries on the next call", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("MONGODB_URI", "mongodb://127.0.0.1:1/unreachable?serverSelectionTimeoutMS=300");
    resetEnvCache();
    await expect(connectToDatabase()).rejects.toMatchObject({ status: 503, code: "DATABASE_UNAVAILABLE" });

    vi.stubEnv("MONGODB_URI", mongo.getUri());
    resetEnvCache();
    await expect(connectToDatabase()).resolves.toBeTruthy();
    expect(await pingDatabase()).toBe(true);
  }, 30_000);
});

describe("connectionOptions", () => {
  it("uses serverless-friendly pool and timeout settings", () => {
    const opts = connectionOptions({ MONGODB_MAX_POOL_SIZE: 10 });
    expect(opts).toMatchObject({ bufferCommands: false, maxPoolSize: 10, minPoolSize: 0, serverSelectionTimeoutMS: 8000 });
    expect(opts.maxIdleTimeMS).toBeGreaterThan(0);
  });
});
