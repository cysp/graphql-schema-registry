import type { FastifyInstance } from "fastify";

export async function waitForFastifyServerStop(server: FastifyInstance): Promise<void> {
  await new Promise<void>((resolve) => {
    server.addHook("onClose", () => {
      resolve();
    });
  });
}
