// oxlint-disable no-process-env

import { spawn } from "node:child_process";

type PgschemaCommand = "dump" | "plan" | "apply";

const commandArg = process.argv[2];
const passthroughArgs = process.argv.slice(3);

if (commandArg !== "dump" && commandArg !== "plan" && commandArg !== "apply") {
  throw new Error("Usage: pgschema.ts <dump|plan|apply> [pgschema args]");
}
const command: PgschemaCommand = commandArg;

const databaseUrl = process.env["DATABASE_URL"];

if (typeof databaseUrl !== "string" || databaseUrl === "") {
  throw new Error("DATABASE_URL is required");
}

const url = new URL(databaseUrl);
const host = url.hostname;
const port = url.port === "" ? "5432" : url.port;
const db = decodeURIComponent(url.pathname.replace(/^\//, ""));
const user = decodeURIComponent(url.username);
const password = decodeURIComponent(url.password);
const schemaEnv = process.env["PGSCHEMA_SCHEMA"];
const pgschemaBinEnv = process.env["PGSCHEMA_BIN"];
const schema = typeof schemaEnv === "string" && schemaEnv !== "" ? schemaEnv : "public";
const pgschemaBin =
  typeof pgschemaBinEnv === "string" && pgschemaBinEnv !== "" ? pgschemaBinEnv : "pgschema";

if (host === "") {
  throw new Error("DATABASE_URL host is required");
}

if (db === "") {
  throw new Error("DATABASE_URL database name is required");
}

if (user === "") {
  throw new Error("DATABASE_URL user is required");
}

const args = [
  command,
  "--host",
  host,
  "--port",
  port,
  "--db",
  db,
  "--user",
  user,
  "--schema",
  schema,
  ...passthroughArgs,
];

const childEnv: NodeJS.ProcessEnv = Object.assign({}, process.env);
if (password !== "") {
  childEnv["PGPASSWORD"] = password;
}

const child = spawn(pgschemaBin, args, {
  stdio: "inherit",
  env: childEnv,
});

await new Promise<void>((resolve, reject) => {
  child.on("error", reject);
  child.on("exit", (code, signal) => {
    if (signal !== null) {
      reject(new Error(`pgschema exited with signal ${signal}`));
      return;
    }

    if (code !== null && code !== 0) {
      process.exitCode = code;
    } else {
      process.exitCode = 0;
    }

    resolve();
  });
});

if (process.exitCode !== 0) {
  throw new Error("pgschema command failed");
}
