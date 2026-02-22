import postgres from "postgres";

import { loadJwtVerificationPublicKeyFromFile } from "./domain/jwt.ts";
import { createDrizzleClient } from "./drizzle/client.ts";
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
    database = createDrizzleClient({ client: postgresClient });
  }

  let jwtVerification;
  if (env.jwtVerification) {
    const verificationPublicKey = await loadJwtVerificationPublicKeyFromFile(
      env.jwtVerification.publicKeyPath,
    );

    jwtVerification = {
      audience: env.jwtVerification.audience,
      issuer: env.jwtVerification.issuer,
      verificationPublicKey,
    };
  }

  try {
    const server = createFastifyServer({
      database,
      jwtVerification,
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
