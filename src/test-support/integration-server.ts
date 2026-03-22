import type { FastifyInstance } from "fastify";

import type { JwtVerification } from "../domain/jwt.ts";
import { createFastifyServer } from "../server.ts";
import { connectIntegrationDatabase } from "./database.ts";

export function adminHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
  };
}

export function adminIfMatchHeaders(token: string, etag: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "if-match": etag,
  };
}

export function parseJson(response: { json: () => unknown }): unknown {
  return response.json();
}

export async function withIntegrationServer(
  databaseUrl: string,
  jwtVerification: JwtVerification,
  run: (server: FastifyInstance) => Promise<void>,
): Promise<void> {
  const integrationDatabase = await connectIntegrationDatabase(databaseUrl);
  const server = createFastifyServer({
    database: integrationDatabase.database.database,
    jwtVerification,
  });

  try {
    await server.ready();
    await run(server);
  } finally {
    await server.close();
    await integrationDatabase.close();
  }
}
