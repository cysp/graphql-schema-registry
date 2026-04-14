import type { FastifyInstance } from "fastify";

import { authorizationDetailsType } from "../domain/authorization/details.ts";
import { createAuthJwtSigner } from "../domain/jwt-signer.ts";
import type { JwtVerification } from "../domain/jwt.ts";
import type { PostgresJsDatabase } from "../drizzle/types.ts";
import { createFastifyServer } from "../server.ts";
import {
  createIntegrationDatabaseEnvironment,
  type IntegrationDatabase,
  type IntegrationDatabaseEnvironment,
} from "./database.ts";

export type IntegrationServerFixture = Readonly<{
  close: () => Promise<void>;
  database: PostgresJsDatabase;
  environment: IntegrationDatabaseEnvironment;
  openSession: IntegrationDatabaseEnvironment["openSession"];
  server: FastifyInstance;
  sql: IntegrationDatabase["sql"];
}>;

type CreateIntegrationServerFixtureOptions = Readonly<{
  databaseFactory?: (database: PostgresJsDatabase) => PostgresJsDatabase;
  databaseUrl: string;
  jwtVerification: JwtVerification;
}>;

export function authorizationHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
  };
}

export function authorizationIfMatchHeaders(token: string, etag: string): Record<string, string> {
  return {
    ...authorizationHeaders(token),
    "if-match": etag,
  };
}

export function parseJson(response: { json: () => unknown }): unknown {
  return response.json();
}

export function createGraphManageIntegrationAuth(): Readonly<{
  graphManageToken: string;
  createToken: ReturnType<typeof createAuthJwtSigner>["createToken"];
  jwtVerification: JwtVerification;
}> {
  const jwtSigner = createAuthJwtSigner();
  return {
    graphManageToken: jwtSigner.createToken({
      authorization_details: [
        {
          graph_id: "*",
          scope: "graph:manage",
          type: authorizationDetailsType,
        },
      ],
    }),
    createToken: jwtSigner.createToken,
    jwtVerification: jwtSigner.jwtVerification,
  };
}

export async function createIntegrationServerFixture({
  databaseFactory,
  databaseUrl,
  jwtVerification,
}: CreateIntegrationServerFixtureOptions): Promise<IntegrationServerFixture> {
  const environment = await createIntegrationDatabaseEnvironment(databaseUrl);
  const database = databaseFactory?.(environment.primary.database) ?? environment.primary.database;
  const server = createFastifyServer({
    database,
    jwtVerification,
    logger: false,
  });

  try {
    await server.ready();
  } catch (error) {
    try {
      try {
        await server.close();
      } catch {
        // Preserve the original startup failure as the primary error.
      }
    } finally {
      await environment.close();
    }
    throw error;
  }

  return {
    close: async () => {
      try {
        await server.close();
      } finally {
        await environment.close();
      }
    },
    database,
    environment,
    openSession: environment.openSession,
    server,
    sql: environment.primary.sql,
  };
}

export async function withIntegrationServer(
  databaseUrl: string,
  jwtVerification: JwtVerification,
  run: (server: FastifyInstance) => Promise<void>,
): Promise<void> {
  const fixture = await createIntegrationServerFixture({
    databaseUrl,
    jwtVerification,
  });

  try {
    await run(fixture.server);
  } finally {
    await fixture.close();
  }
}

export async function withConcurrentIntegrationServer(
  options: CreateIntegrationServerFixtureOptions,
  run: (fixture: IntegrationServerFixture) => Promise<void>,
): Promise<void> {
  const fixture = await createIntegrationServerFixture(options);

  try {
    await run(fixture);
  } finally {
    await fixture.close();
  }
}
