import fastifyJwt, { type FastifyJWTOptions } from "@fastify/jwt";
import fastifySensible from "@fastify/sensible";
import { sql } from "drizzle-orm";
import fastify, { type FastifyInstance } from "fastify";

import { formatUser } from "./domain/authorization/user.ts";
import type { JwtVerification } from "./domain/jwt.ts";
import type { PostgresJsDatabase } from "./drizzle/types.ts";
import { bearerAuthenticateHeaders } from "./lib/fastify/authorization/bearer-authenticate-headers.ts";
import { requireAdminUser } from "./lib/fastify/authorization/guards.ts";
import { healthcheckPlugin } from "./lib/fastify/healthcheck/plugin.ts";
import { openApiRoutesPlugin } from "./lib/fastify/openapi/plugin.ts";
import { problemDetailsErrorHandler } from "./lib/fastify/problem-details/error-handler.ts";
import { problemDetailsPlugin } from "./lib/fastify/problem-details/plugin.ts";

type CreateFastifyServerOptions = {
  database?: Pick<PostgresJsDatabase, "execute"> | undefined;
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
  server.register(problemDetailsPlugin);

  server.setNotFoundHandler((_request, reply) => {
    return reply.problemDetails({ status: 404 });
  });

  server.setErrorHandler(problemDetailsErrorHandler);

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
  }

  server.register(async function (server) {
    if (jwtVerification) {
      server.addHook("onRequest", async (request, reply) => {
        const authorizationHeader = request.headers.authorization;
        if (typeof authorizationHeader !== "string" || authorizationHeader.trim() === "") {
          return reply.problemDetails({
            status: 401,
            headers: bearerAuthenticateHeaders,
          });
        }

        try {
          await request.jwtVerify();
        } catch (error) {
          request.log.warn({ error }, "failed to validate bearer token claims");
          return reply.problemDetails({
            status: 401,
            headers: bearerAuthenticateHeaders,
          });
        }
      });
    }

    server.get("/", async (_, reply) => {
      return reply.code(204).send();
    });

    server.get("/user/grants", async (request, reply) => {
      if (!request.user) {
        return reply.problemDetails({
          status: 401,
          headers: bearerAuthenticateHeaders,
        });
      }

      return reply.code(200).send(request.user.grants);
    });

    server.register(openApiRoutesPlugin, {
      operationHandlers: {
        createGraph: async (request, reply) => {
          if (!requireAdminUser(request, reply)) {
            return;
          }

          return reply.problemDetails({ status: 501 });
        },
        createSubgraph: async (request, reply) => {
          if (!requireAdminUser(request, reply)) {
            return;
          }

          return reply.problemDetails({ status: 501 });
        },
        deleteGraph: async (request, reply) => {
          if (!requireAdminUser(request, reply)) {
            return;
          }

          return reply.problemDetails({ status: 501 });
        },
        deleteSubgraph: async (request, reply) => {
          if (!requireAdminUser(request, reply)) {
            return;
          }

          return reply.problemDetails({ status: 501 });
        },
        getGraph: async (request, reply) => {
          if (!requireAdminUser(request, reply)) {
            return;
          }

          return reply.problemDetails({ status: 501 });
        },
        getSubgraph: async (request, reply) => {
          if (!requireAdminUser(request, reply)) {
            return;
          }

          return reply.problemDetails({ status: 501 });
        },
        listGraphs: async (request, reply) => {
          if (!requireAdminUser(request, reply)) {
            return;
          }

          return reply.problemDetails({ status: 501 });
        },
        listSubgraphs: async (request, reply) => {
          if (!requireAdminUser(request, reply)) {
            return;
          }

          return reply.problemDetails({ status: 501 });
        },
        updateGraph: async (request, reply) => {
          if (!requireAdminUser(request, reply)) {
            return;
          }

          return reply.problemDetails({ status: 501 });
        },
        updateSubgraph: async (request, reply) => {
          if (!requireAdminUser(request, reply)) {
            return;
          }

          return reply.problemDetails({ status: 501 });
        },
      },
    });
  });

  return server;
}
