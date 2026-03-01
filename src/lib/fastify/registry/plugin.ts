import type { FastifyReply, FastifyRequest } from "fastify";
import fastifyPlugin from "fastify-plugin";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import {
  createGraphBodySchema,
  createSubgraphBodySchema,
  graphParamsSchema,
  subgraphParamsSchema,
} from "./schemas.ts";

function sendNotImplemented(_request: FastifyRequest, reply: FastifyReply): void {
  reply.code(501).send();
}

const registryPluginImpl: FastifyPluginCallbackZod = (server, _options, done): void => {
  server.post(
    "/v1/graphs",
    {
      schema: {
        body: createGraphBodySchema,
      },
    },
    sendNotImplemented,
  );

  server.get(
    "/v1/graphs/:graphId",
    {
      schema: {
        params: graphParamsSchema,
      },
    },
    sendNotImplemented,
  );

  server.delete(
    "/v1/graphs/:graphId",
    {
      schema: {
        params: graphParamsSchema,
      },
    },
    sendNotImplemented,
  );

  server.put(
    "/v1/graphs/:graphId",
    {
      schema: {
        params: graphParamsSchema,
      },
    },
    sendNotImplemented,
  );

  server.post(
    "/v1/graphs/:graphId/subgraphs",
    {
      schema: {
        body: createSubgraphBodySchema,
        params: graphParamsSchema,
      },
    },
    sendNotImplemented,
  );

  server.get(
    "/v1/graphs/:graphId/subgraphs/:subgraphId",
    {
      schema: {
        params: subgraphParamsSchema,
      },
    },
    sendNotImplemented,
  );

  server.delete(
    "/v1/graphs/:graphId/subgraphs/:subgraphId",
    {
      schema: {
        params: subgraphParamsSchema,
      },
    },
    sendNotImplemented,
  );

  server.put(
    "/v1/graphs/:graphId/subgraphs/:subgraphId",
    {
      schema: {
        params: subgraphParamsSchema,
      },
    },
    sendNotImplemented,
  );

  server.get(
    "/v1/graphs/:graphId/supergraph.graphqls",
    {
      schema: {
        params: graphParamsSchema,
      },
    },
    sendNotImplemented,
  );

  server.put(
    "/v1/graphs/:graphId/subgraphs/:subgraphId/schema.graphql",
    {
      schema: {
        params: subgraphParamsSchema,
      },
    },
    sendNotImplemented,
  );

  done();
};

export const registryPlugin = fastifyPlugin(registryPluginImpl, {
  fastify: "5.x",
  name: "registry",
});
