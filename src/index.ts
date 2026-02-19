import { createProcessSignalAbortController } from "./lib/abort.ts";
import { parseEnv } from "./lib/env.ts";
import { waitForFastifyServerStop } from "./lib/fastify.ts";
import { createFastifyServer } from "./server.ts";

async function main(): Promise<void> {
  const env = parseEnv();

  const abortController = createProcessSignalAbortController();

  const server = createFastifyServer();

  const serverClosedPromise = waitForFastifyServerStop(server);

  const listening = await server.listen({
    port: env.port,
    signal: abortController.signal,
  });

  server.log.info({}, "server started: %s", listening);

  await serverClosedPromise;
}

await main();
