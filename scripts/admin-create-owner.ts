/**
 * Creates an Owner admin account. The password is hashed with bcrypt and never printed,
 * logged or stored in plain text.
 *
 *   npm run admin:create-owner -- --username owner --name "Your Name" [--email you@example.com]
 *
 * The password is typed at a hidden prompt. For non-interactive use it can instead be passed in
 * the ADMIN_INITIAL_PASSWORD environment variable (never as a command-line argument, which
 * would show up in shell history and process lists).
 *
 * Refuses to run if an owner already exists, unless you pass --another.
 */
import { loadEnvConfig } from "@next/env";
import { createInterface } from "node:readline";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function askHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    console.error("Run this in an interactive terminal so the password can be typed privately (or set ADMIN_INITIAL_PASSWORD).");
    process.exit(1);
  }
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let prompted = false;
    out._writeToOutput = (s: string) => {
      // Show the question once; mask everything typed after it.
      if (!prompted) {
        out.output.write(s);
        prompted = true;
      } else if (s.includes("\n") || s.includes("\r")) out.output.write("\n");
      else out.output.write("*".repeat(s.length > 1 ? 0 : 1));
    };
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

const USAGE = 'Usage: npm run admin:create-owner -- --username owner --name "Your Name" [--email you@example.com]';

async function main() {
  const username = arg("username")?.trim().toLowerCase();
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name")?.trim();
  if (!name || (!username && !email)) {
    console.error(USAGE);
    process.exit(1);
  }
  if (username && !/^[a-z0-9._@&-]{3,40}$/.test(username)) {
    console.error("Username: use 3–40 letters, numbers or . _ - @ &");
    process.exit(1);
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    console.error("That email address doesn't look valid.");
    process.exit(1);
  }

  const { connectToDatabase, disconnectFromDatabase } = await import("@/server/db/connect");
  const { Admin, Role } = await import("@/server/models");
  const { hashPassword, passwordSchema } = await import("@/server/auth/password");

  await connectToDatabase();
  const owner = await Role.findOne({ key: "owner" }).lean();
  if (!owner) {
    console.error('The "owner" role is missing. Run `npm run db:seed` first.');
    process.exit(1);
  }
  if (!process.argv.includes("--another") && (await Admin.exists({ role: owner._id }))) {
    console.error("An Owner account already exists. Pass --another to add a second owner.");
    process.exit(1);
  }
  const taken = await Admin.exists({ $or: [...(username ? [{ username }] : []), ...(email ? [{ email }] : [])] });
  if (taken) {
    console.error("An admin with that username or email already exists.");
    process.exit(1);
  }

  let password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!password) {
    console.log("Password rules: at least 12 characters, including a letter and a number.");
    password = await askHidden("Password: ");
    if ((await askHidden("Repeat password: ")) !== password) {
      console.error("Passwords don't match.");
      process.exit(1);
    }
  }
  const check = passwordSchema.safeParse(password);
  if (!check.success) {
    console.error(check.error.issues.map((i) => i.message).join(" "));
    process.exit(1);
  }

  await Admin.create({ name, username, email, passwordHash: await hashPassword(password), role: owner._id, status: "active" });
  console.log(`\nOwner account created${username ? ` — username: ${username}` : ""}${email ? ` — email: ${email}` : ""}. Sign in at /mm-hub/login.`);
  await disconnectFromDatabase();
}

main().catch((err) => {
  const e = err as Error & { describe?: () => string };
  console.error("admin:create-owner failed:", e.describe?.() ?? e.message);
  process.exit(1);
});
