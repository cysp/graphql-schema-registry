import { STATUS_CODES, type OutgoingHttpHeaders } from "node:http";

import type { FastifyPluginAsync, FastifyReply } from "fastify";
import fastifyPlugin from "fastify-plugin";

import { requireProblemDetailsStatusCode, type ProblemDetailsStatusCode } from "./status-code.ts";

const defaultProblemType = "about:blank";

type ProblemDetailsOptions = {
  type?: string;
  status: ProblemDetailsStatusCode;
  title?: string;
  headers?: OutgoingHttpHeaders | undefined;
};

declare module "fastify" {
  interface FastifyReply {
    problemDetails(options: ProblemDetailsOptions): this;
  }
}

function replyProblemDetails<Reply extends FastifyReply>(
  this: Reply,
  { type = defaultProblemType, status, title, headers }: ProblemDetailsOptions,
): Reply {
  const statusCode = requireProblemDetailsStatusCode(status);

  if (headers) {
    this.headers(headers);
  }

  this.code(statusCode)
    .type("application/problem+json")
    .send({
      type,
      status: statusCode,
      title: title ?? STATUS_CODES[statusCode] ?? "Unknown Error",
    });

  return this;
}

const problemDetailsPluginDefinition: FastifyPluginAsync = async (server) => {
  server.decorateReply("problemDetails", replyProblemDetails);
};

export const problemDetailsPlugin = fastifyPlugin(problemDetailsPluginDefinition, {
  name: "problem-details",
  fastify: "5.x",
});
