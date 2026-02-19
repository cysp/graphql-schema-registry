import fastify, { type FastifyInstance } from "fastify";

export function createFastifyServer(): FastifyInstance {
  const server = fastify({
    logger: true,
  });

  server.get("/health", () => {
    return {
      status: "ok",
    } as const;
  });

  return server;
}
