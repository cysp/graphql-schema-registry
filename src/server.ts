import fastifyJwt, { type FastifyJWTOptions } from "@fastify/jwt";
import fastifySensible from "@fastify/sensible";
import type { JsonSchemaToTsProvider } from "@fastify/type-provider-json-schema-to-ts";
import { sql } from "drizzle-orm";
import fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
} from "fastify";

import { formatUser } from "./domain/authorization/user.ts";
import type { JwtVerification } from "./domain/jwt.ts";
import { createGraphHandler } from "./domain/routes/create-graph.ts";
import { createSubgraphHandler } from "./domain/routes/create-subgraph.ts";
import { deleteGraphHandler } from "./domain/routes/delete-graph.ts";
import { deleteSubgraphSchemaHandler } from "./domain/routes/delete-subgraph-schema.ts";
import { deleteSubgraphHandler } from "./domain/routes/delete-subgraph.ts";
import { getGraphHandler } from "./domain/routes/get-graph.ts";
import { getSubgraphSchemaHandler } from "./domain/routes/get-subgraph-schema.ts";
import { getSubgraphHandler } from "./domain/routes/get-subgraph.ts";
import { getSupergraphSchemaHandler } from "./domain/routes/get-supergraph-schema.ts";
import { listGraphsHandler } from "./domain/routes/list-graphs.ts";
import { listSubgraphsHandler } from "./domain/routes/list-subgraphs.ts";
import { publishSubgraphSchemaHandler } from "./domain/routes/publish-subgraph-schema.ts";
import { updateGraphHandler } from "./domain/routes/update-graph.ts";
import { updateSubgraphHandler } from "./domain/routes/update-subgraph.ts";
import type { PostgresJsDatabase } from "./drizzle/types.ts";
import { bearerAuthenticateHeaders } from "./lib/fastify/authorization/bearer-authenticate-headers.ts";
import { fastifyHandlerWithDependencies } from "./lib/fastify/handler-with-dependencies.ts";
import { healthcheckPlugin } from "./lib/fastify/healthcheck/plugin.ts";
import { operationRouteDefinitions } from "./lib/fastify/openapi/generated/operations/index.ts";
import { openApiRoutesPlugin } from "./lib/fastify/openapi/plugin.ts";
import { problemDetailsErrorHandler } from "./lib/fastify/problem-details/error-handler.ts";
import { problemDetailsPlugin } from "./lib/fastify/problem-details/plugin.ts";

type CreateFastifyServerOptions = {
  database?: PostgresJsDatabase | undefined;
  jwtVerification?: JwtVerification | undefined;
  logger?: boolean | undefined;
};

export function createFastifyServer({
  database,
  jwtVerification,
  logger = true,
}: CreateFastifyServerOptions): FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  FastifyBaseLogger,
  JsonSchemaToTsProvider
> {
  const server = fastify({
    logger,
  }).withTypeProvider<JsonSchemaToTsProvider>();

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

    const routeDependencies = { database };

    server.register(openApiRoutesPlugin(operationRouteDefinitions), {
      operationHandlers: {
        createGraph: fastifyHandlerWithDependencies(createGraphHandler, routeDependencies),
        createSubgraph: fastifyHandlerWithDependencies(createSubgraphHandler, routeDependencies),
        deleteGraph: fastifyHandlerWithDependencies(deleteGraphHandler, routeDependencies),
        deleteSubgraphSchema: fastifyHandlerWithDependencies(
          deleteSubgraphSchemaHandler,
          routeDependencies,
        ),
        deleteSubgraph: fastifyHandlerWithDependencies(deleteSubgraphHandler, routeDependencies),
        getGraph: fastifyHandlerWithDependencies(getGraphHandler, routeDependencies),
        getSupergraphSchema: fastifyHandlerWithDependencies(
          getSupergraphSchemaHandler,
          routeDependencies,
        ),
        getSubgraphSchema: fastifyHandlerWithDependencies(
          getSubgraphSchemaHandler,
          routeDependencies,
        ),
        getSubgraph: fastifyHandlerWithDependencies(getSubgraphHandler, routeDependencies),
        listGraphs: fastifyHandlerWithDependencies(listGraphsHandler, routeDependencies),
        listSubgraphs: fastifyHandlerWithDependencies(listSubgraphsHandler, routeDependencies),
        publishSubgraphSchema: fastifyHandlerWithDependencies(
          publishSubgraphSchemaHandler,
          routeDependencies,
        ),
        updateGraph: fastifyHandlerWithDependencies(updateGraphHandler, routeDependencies),
        updateSubgraph: fastifyHandlerWithDependencies(updateSubgraphHandler, routeDependencies),
      },
    });
  });

  return server;
}
