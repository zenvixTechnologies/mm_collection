/**
 * Creates every MongoDB collection and builds its indexes from the Mongoose schemas.
 * Safe to re-run: existing collections are kept, indexes are brought in line with the schemas
 * (new ones built, ones no longer in a schema dropped). Never touches documents.
 *
 *   npm run db:setup
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

async function main() {
  const { connectToDatabase, disconnectFromDatabase } = await import("@/server/db/connect");
  const models = await import("@/server/models");

  const mongoose = await connectToDatabase();
  console.log(`Connected to database "${mongoose.connection.name}"\n`);

  const existing = new Set(
    (await mongoose.connection.db!.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
  );

  for (const model of Object.values(models)) {
    const name = model.collection.collectionName;
    const created = !existing.has(name);
    if (created) await model.createCollection();
    const dropped = await model.syncIndexes();
    const indexes = await model.collection.indexes();
    console.log(
      `${created ? "created " : "exists  "} ${name.padEnd(22)} ${String(indexes.length).padStart(2)} indexes` +
        (dropped.length ? `  (dropped stale: ${dropped.join(", ")})` : ""),
    );
  }

  await disconnectFromDatabase();
  console.log("\nDone.");
}

main().catch(async (err) => {
  const e = err as Error & { cause?: Error; describe?: () => string };
  if (e.describe) e.message = e.describe(); // config problems: names the variable, never its value
  console.error("db:setup failed:", e.message, e.cause ? `— ${e.cause.message}` : "");
  process.exit(1);
});
