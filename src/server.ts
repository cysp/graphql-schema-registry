import fastifyJwt, { type FastifyJWTOptions } from "@fastify/jwt";
import fastifySensible from "@fastify/sensible";
import { sql } from "drizzle-orm";
import fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";

import { createGraphHandler } from "./domain/routes/create-graph.ts";
import { deleteGraphHandler } from "./domain/routes/delete-graph.ts";
import { deleteSubgraphHandler } from "./domain/routes/delete-subgraph.ts";
import { getGraphHandler } from "./domain/routes/get-graph.ts";
import { getSubgraphHandler } from "./domain/routes/get-subgraph.ts";
import { listGraphsHandler } from "./domain/routes/list-graphs.ts";
import { listSubgraphsHandler } from "./domain/routes/list-subgraphs.ts";
import { updateGraphHandler } from "./domain/routes/update-graph.ts";
import { upsertSubgraphHandler } from "./domain/routes/upsert-subgraph.ts";
import { formatUser } from "./domain/authorization/user.ts";
import type { PostgresJsDatabase } from "./drizzle/types.ts";
import { healthcheckPlugin } from "./lib/fastify/healthcheck/plugin.ts";
import { fastifyHandlerWithDependencies } from "./lib/fastify/handler-with-dependencies.ts";
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
      listGraphs: fastifyHandlerWithDependencies(listGraphsHandler, { database }),
      createGraph: fastifyHandlerWithDependencies(createGraphHandler, { database }),
      getGraph: fastifyHandlerWithDependencies(getGraphHandler, { database }),
      updateGraph: fastifyHandlerWithDependencies(updateGraphHandler, { database }),
      deleteGraph: fastifyHandlerWithDependencies(deleteGraphHandler, { database }),
      listSubgraphs: listSubgraphsHandler,
      getSubgraph: getSubgraphHandler,
      upsertSubgraph: upsertSubgraphHandler,
      deleteSubgraph: deleteSubgraphHandler,
    },
  });

  return server;
}
