import fastifyJwt, { type FastifyJWTOptions } from "@fastify/jwt";
import fastifySensible from "@fastify/sensible";
import { sql } from "drizzle-orm";
import fastify, { type FastifyInstance } from "fastify";

import { formatUser } from "./domain/authorization/user.ts";
import type { JwtVerification } from "./domain/jwt.ts";
import { createGraphHandler } from "./domain/routes/create-graph.ts";
import { createSubgraphHandler } from "./domain/routes/create-subgraph.ts";
import { deleteGraphHandler } from "./domain/routes/delete-graph.ts";
import { deleteSubgraphHandler } from "./domain/routes/delete-subgraph.ts";
import { getGraphHandler } from "./domain/routes/get-graph.ts";
import { getSubgraphHandler } from "./domain/routes/get-subgraph.ts";
import { listGraphsHandler } from "./domain/routes/list-graphs.ts";
import { listSubgraphsHandler } from "./domain/routes/list-subgraphs.ts";
import { updateGraphHandler } from "./domain/routes/update-graph.ts";
import { updateSubgraphHandler } from "./domain/routes/update-subgraph.ts";
import type { PostgresJsDatabase } from "./drizzle/types.ts";
import { fastifyHandlerWithDependencies } from "./lib/fastify/handler-with-dependencies.ts";
import { healthcheckPlugin } from "./lib/fastify/healthcheck/plugin.ts";
import { fastifyOpenApiRoutesPlugin } from "./lib/fastify/openapi/plugin.ts";

type CreateFastifyServerOptions = {
  database?: PostgresJsDatabase | undefined;
  jwtVerification?: JwtVerification | undefined;
};

export function createFastifyServer({
  database,
  jwtVerification,
}: CreateFastifyServerOptions): FastifyInstance {
  const server = fastify({
    logger: true,
  });

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
        reply.unauthorized();
      }
    });
  }

  server.register(fastifyOpenApiRoutesPlugin, {
    operationHandlers: {
      listGraphs: fastifyHandlerWithDependencies(listGraphsHandler, { database }),
      createGraph: fastifyHandlerWithDependencies(createGraphHandler, { database }),
      getGraph: fastifyHandlerWithDependencies(getGraphHandler, { database }),
      updateGraph: fastifyHandlerWithDependencies(updateGraphHandler, { database }),
      deleteGraph: fastifyHandlerWithDependencies(deleteGraphHandler, { database }),
      listSubgraphs: fastifyHandlerWithDependencies(listSubgraphsHandler, { database }),
      createSubgraph: fastifyHandlerWithDependencies(createSubgraphHandler, { database }),
      getSubgraph: fastifyHandlerWithDependencies(getSubgraphHandler, { database }),
      updateSubgraph: fastifyHandlerWithDependencies(updateSubgraphHandler, { database }),
      deleteSubgraph: fastifyHandlerWithDependencies(deleteSubgraphHandler, { database }),
    },
  });

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
        reply.unauthorized();
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

  server.register(async function (server) {
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
        if (typeof authorizationHeader !== "string" || authorizationHeader.trim() === "") {
          return reply.unauthorized();
        }

        try {
          await request.jwtVerify();
        } catch (error) {
          request.log.warn({ error }, "failed to validate bearer token claims");
          return reply.unauthorized();
        }
      });
    }

    server.get("/", async (_, reply) => {
      return reply.code(204).send();
    });

    server.get("/user/grants", async (request, reply) => {
      if (!request.user) {
        return reply.unauthorized();
      }

      return reply.code(200).send(request.user.grants);
    });

    server.register(openApiRoutesPlugin, {
      operationHandlers: {
        createGraph: async (request, reply) => {
          if (!requireAdminUser(request, reply)) {
            return;
          }

          throw server.httpErrors.notImplemented();
        },
        createSubgraph: async (request, reply) => {
          if (!requireAdminUser(request, reply)) {
            return;
          }

          throw server.httpErrors.notImplemented();
        },
        deleteGraph: async (request, reply) => {
          if (!requireAdminUser(request, reply)) {
            return;
          }

          throw server.httpErrors.notImplemented();
        },
        deleteSubgraph: async (request, reply) => {
          if (!requireAdminUser(request, reply)) {
            return;
          }

          throw server.httpErrors.notImplemented();
        },
        getGraph: async (request, reply) => {
          if (!requireAdminUser(request, reply)) {
            return;
          }

          throw server.httpErrors.notImplemented();
        },
        getSubgraph: async (request, reply) => {
          if (!requireAdminUser(request, reply)) {
            return;
          }

          throw server.httpErrors.notImplemented();
        },
        listGraphs: async (request, reply) => {
          if (!requireAdminUser(request, reply)) {
            return;
          }

          throw server.httpErrors.notImplemented();
        },
        listSubgraphs: async (request, reply) => {
          if (!requireAdminUser(request, reply)) {
            return;
          }

          throw server.httpErrors.notImplemented();
        },
        updateGraph: async (request, reply) => {
          if (!requireAdminUser(request, reply)) {
            return;
          }

          throw server.httpErrors.notImplemented();
        },
        updateSubgraph: async (request, reply) => {
          if (!requireAdminUser(request, reply)) {
            return;
          }

          throw server.httpErrors.notImplemented();
        },
      },
    });
  });

  return server;
}
