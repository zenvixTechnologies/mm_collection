/**
 * TEST HELPER — creates (or removes) throwaway admins in a throwaway database for end-to-end
 * smoke tests. Refuses to touch any database whose name doesn't contain "smoke".
 *
 *   MONGODB_DB_NAME=mm-smoke-test SMOKE_PASSWORD=... node --conditions=react-server --import tsx scripts/smoke-admin.ts create
 *   MONGODB_DB_NAME=mm-smoke-test node --conditions=react-server --import tsx scripts/smoke-admin.ts drop
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

async function main() {
  const db = process.env.MONGODB_DB_NAME ?? "";
  if (!db.includes("smoke")) throw new Error(`Refusing to run against database "${db}" — name must contain "smoke".`);
  const { connectToDatabase, disconnectFromDatabase } = await import("@/server/db/connect");
  const mongoose = await connectToDatabase();

  if (process.argv[2] === "drop") {
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
