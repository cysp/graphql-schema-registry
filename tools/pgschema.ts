// oxlint-disable no-process-env

import { spawn } from "node:child_process";

export function createPgschemaEnvironment(
  databaseUrl: string,
): NodeJS.ProcessEnv {
  const trimmedDatabaseUrl = databaseUrl.trim();
  if (trimmedDatabaseUrl.length === 0) {
    throw new Error("DATABASE_URL must not be blank.");
  }

  let parsedDatabaseUrl: URL;

  try {
    parsedDatabaseUrl = new URL(trimmedDatabaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid postgres connection string.");
  }

  if (
    parsedDatabaseUrl.protocol !== "postgres:" &&
    parsedDatabaseUrl.protocol !== "postgresql:"
  ) {
    throw new Error("DATABASE_URL must use the postgres:// or postgresql:// protocol.");
  }

  const databaseName = decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\/+/, ""));
  if (databaseName.length === 0) {
    throw new Error("DATABASE_URL must include a database name.");
  }

  const username = decodeURIComponent(parsedDatabaseUrl.username);
  if (username.length === 0) {
    throw new Error("DATABASE_URL must include a database user.");
  }

  const pgschemaEnvironment: NodeJS.ProcessEnv = {
    PGDATABASE: databaseName,
    PGUSER: username,
  };

  if (parsedDatabaseUrl.hostname.length > 0) {
    pgschemaEnvironment["PGHOST"] = parsedDatabaseUrl.hostname;
  }

  if (parsedDatabaseUrl.port.length > 0) {
    pgschemaEnvironment["PGPORT"] = parsedDatabaseUrl.port;
  }

  const password = decodeURIComponent(parsedDatabaseUrl.password);
  if (password.length > 0) {
    pgschemaEnvironment["PGPASSWORD"] = password;
  }

  const sslMode = parsedDatabaseUrl.searchParams.get("sslmode")?.trim();
  if (sslMode) {
    pgschemaEnvironment["PGSSLMODE"] = sslMode;
  }

  return pgschemaEnvironment;
}

function shouldSkipDatabaseConfiguration(arguments_: string[]): boolean {
  return (
    arguments_.length === 0 ||
    arguments_[0] === "help" ||
    arguments_.includes("--help") ||
    arguments_.includes("-h")
  );
}

export async function main(): Promise<void> {
  const pgschemaArguments = process.argv.slice(2);
  const databaseUrl = process.env["DATABASE_URL"];

  const env = shouldSkipDatabaseConfiguration(pgschemaArguments)
    ? process.env
    : {
        ...process.env,
        ...createPgschemaEnvironment(databaseUrl ?? ""),
      };

  const childProcess = spawn("pgschema", pgschemaArguments, {
    env,
    stdio: "inherit",
  });

  await new Promise<void>((resolve, reject) => {
    childProcess.once("error", (error) => {
      reject(error);
    });

    childProcess.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`pgschema exited due to signal ${signal}.`));
        return;
      }

      process.exitCode = code ?? 1;
      resolve();
    });
  });
}

if (import.meta.main) {
  await main();
}
