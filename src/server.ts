import fastifyJwt, { type FastifyJWTOptions } from "@fastify/jwt";
import fastifySensible from "@fastify/sensible";
import { sql } from "drizzle-orm";
import fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";

import { formatUser } from "./domain/authorization/user.ts";
import type { PostgresJsDatabase } from "./drizzle/types.ts";
import { requireAdmin } from "./lib/fastify/authorization/guards.ts";
import { createListGraphsHandler, createGetGraphHandler } from "./lib/fastify/graph-handlers.ts";
import {
  createDeleteGraphHandler,
  createUpsertGraphHandler,
} from "./lib/fastify/graph-write-handlers.ts";
import { healthcheckPlugin } from "./lib/fastify/healthcheck/plugin.ts";
import { fastifyRoutesPlugin } from "./lib/openapi-ts/fastify-routes.gen.ts";

type CreateFastifyServerOptions = {
  database?: PostgresJsDatabase | undefined;
  jwtVerification?:
    | {
        audience: string;
        issuer: string;
        verificationPublicKey: Buffer;
      }
    | undefined;
};

export function createFastifyServer({
  database,
  jwtVerification,
}: CreateFastifyServerOptions): FastifyInstance {
  const server = fastify({
    logger: true,
  });

  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);

  server.register(fastifySensible);

  if (jwtVerification) {
    const verifyOptions: NonNullable<FastifyJWTOptions["verify"]> = {
      algorithms: ["RS256"],
      allowedAud: jwtVerification.audience,
      allowedIss: jwtVerification.issuer,
    };

    server.register(fastifyJwt, {
      formatUser,
      secret: {
        public: jwtVerification.verificationPublicKey,
      },
      verify: verifyOptions,
    });

    server.addHook("onRequest", async (request, reply) => {
      const authorizationHeader = request.headers.authorization;
      if (typeof authorizationHeader !== "string" || !authorizationHeader.startsWith("Bearer ")) {
        return;
      }

      try {
        await request.jwtVerify();
      } catch (error) {
        request.log.warn({ error }, "failed to validate bearer token claims");
        reply.unauthorized("Invalid bearer token.");
      }
    });
  }

  server.register(healthcheckPlugin, {
    probes: {
      database: async () => {
        if (!database) {
          return "warn";
        }

        await database.execute(sql`SELECT 1`);
        return "ok";
      },
    },
  });

  server.register(fastifyRoutesPlugin, {
    routes: {
      listGraphs: {
        preHandler: requireAdmin,
        handler: createListGraphsHandler({ database }),
      },
      getGraph: {
        handler: createGetGraphHandler({ database }),
      },
      upsertGraph: {
        preHandler: requireAdmin,
        handler: createUpsertGraphHandler({ database }),
      },
      deleteGraph: {
        preHandler: requireAdmin,
        handler: createDeleteGraphHandler({ database }),
      },
      listSubgraphs: {
        handler(_request, reply) {
          reply.notImplemented();
        },
      },
      getSubgraph: {
        handler(_request, reply) {
          reply.notImplemented();
        },
      },
      upsertSubgraph: {
        handler(_request, reply) {
          reply.notImplemented();
        },
      },
      deleteSubgraph: {
        handler(_request, reply) {
          reply.notImplemented();
        },
      },
    },
  });

  return server;
}
