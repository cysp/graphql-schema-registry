import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { RouteHandlers } from "../../lib/openapi-ts/fastify.gen.ts";

export const upsertSubgraphHandler: RouteHandlers["upsertSubgraph"] = (request, reply) => {
  if (!requireAdminUser(request, reply)) {
    return;
  }

  reply.notImplemented();
};
