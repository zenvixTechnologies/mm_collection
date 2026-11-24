/**
 * TEST HELPER — creates (or removes) throwaway admins in a throwaway database for end-to-end
 * smoke tests. Refuses to touch any database whose name doesn't contain "smoke".
 *
 *   MONGODB_DB_NAME=mm-smoke-test SMOKE_PASSWORD=... node --conditions=react-server --import tsx scripts/smoke-admin.ts create
 *   MONGODB_DB_NAME=mm-smoke-test node --conditions=react-server --import tsx scripts/smoke-admin.ts drop
 *   MONGODB_DB_NAME=mm-smoke-test node --conditions=react-server --import tsx scripts/smoke-admin.ts reset-token <email>
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

async function main() {
  const db = process.env.MONGODB_DB_NAME ?? "";
  if (!db.includes("smoke")) throw new Error(`Refusing to run against database "${db}" — name must contain "smoke".`);
  const { connectToDatabase, disconnectFromDatabase } = await import("@/server/db/connect");
  const mongoose = await connectToDatabase();

  if (process.argv[2] === "reset-token") {
    // Plants a known password-reset token for a smoke customer (Resend isn't used in smoke tests).
    const { createHmac, randomBytes } = await import("node:crypto");
    const { User } = await import("@/server/models");
    const token = randomBytes(32).toString("base64url");
    const hash = createHmac("sha256", `reset:${process.env.JWT_REFRESH_SECRET}`).update(token).digest("base64url");
    const res = await User.updateOne(
      { email: process.argv[3] },
      { $set: { passwordReset: { tokenHash: hash, expiresAt: new Date(Date.now() + 30 * 60_000), requestedAt: new Date() } } },
    );
    if (!res.matchedCount) throw new Error("No such smoke customer");
    console.log(token);
  } else if (process.argv[2] === "drop") {
    await mongoose.connection.db!.dropDatabase();
    console.log(`Dropped database "${db}".`);
  } else {
    const password = process.env.SMOKE_PASSWORD;
    if (!password) throw new Error("SMOKE_PASSWORD is required");
    const { Admin, Role } = await import("@/server/models");
    const { hashPassword } = await import("@/server/auth/password");
    for (const key of ["owner", "manager", "staff"] as const) {
      const role = await Role.findOne({ key }).lean();
      await Admin.updateOne(
        { email: `${key}@smoke.test` },
        { $set: { name: `Smoke ${key}`, passwordHash: await hashPassword(password), role: role!._id, status: "active", failedLoginCount: 0, lockedUntil: null } },
        { upsert: true },
      );
    }
    console.log(`Smoke admins ready in "${db}": owner@smoke.test, manager@smoke.test, staff@smoke.test`);
  }
  await disconnectFromDatabase();
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
