import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { createProcessSignalAbortController } from "./lib/abort.ts";
import { parseEnv } from "./lib/env.ts";
import { waitForFastifyServerStop } from "./lib/fastify.ts";
import { createFastifyServer } from "./server.ts";

async function main(): Promise<void> {
  const env = parseEnv();

  const abortController = createProcessSignalAbortController();

  let postgresClient;
  let database;
  if (env.databaseUrl) {
    postgresClient = postgres(env.databaseUrl);
    database = drizzle({ client: postgresClient });
  }

  try {
    const server = createFastifyServer({
      database,
    });

    const serverClosedPromise = waitForFastifyServerStop(server);

    const listeningAddress = await server.listen({
      host: env.host,
      port: env.port,
      signal: abortController.signal,
    });

    server.log.info({}, "server started: %s", listeningAddress);

    await serverClosedPromise;
  } finally {
    await postgresClient?.end({
      timeout: 5,
    });
  }
}

await main();
