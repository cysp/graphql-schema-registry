import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminGrant } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import {
  dryRunSubgraphSchemaComposition,
  loadActiveSchemaRevisionMap,
  normalizeSchemaSdl,
} from "../composition.ts";
import { selectActiveGraphBySlugForUpdate } from "../database/graphs/repository.ts";
import {
  selectActiveSubgraphByGraphIdAndSlugForUpdate,
  selectActiveSubgraphsByGraphId,
} from "../database/subgraphs/repository.ts";
import type { ValidateSubgraphSchemaPayload } from "./payloads.ts";

type OperationHandlers = OpenApiOperationHandlers<
  keyof typeof operationRouteDefinitions,
  typeof operationRouteDefinitions
>;

type RouteDependencies = {
  database: PostgresJsDatabase | undefined;
};

function buildValidatePayload(diagnostics: string[]): ValidateSubgraphSchemaPayload {
  return {
    diagnostics,
  };
}

export const validateSubgraphSchemaHandler: DependencyInjectedHandler<
  OperationHandlers["validateSubgraphSchema"],
  RouteDependencies
> = async ({ dependencies: { database }, request, reply }) => {
  if (!requireAdminGrant(request, reply)) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  let normalizedSdl: string;
  try {
    normalizedSdl = normalizeSchemaSdl(request.body);
  } catch (error) {
    request.log.warn({ error }, "invalid subgraph schema");
    return reply
      .code(422)
      .type("application/problem+json")
      .send({
        type: "about:blank",
        title: "Unprocessable Entity",
        status: 422,
        diagnostics: [error instanceof Error ? error.message : "Invalid subgraph schema."],
      });
  }

  const result = await database.transaction(async (transaction) => {
    const graph = await selectActiveGraphBySlugForUpdate(transaction, request.params.graphSlug);
    if (!graph) {
      return { kind: "not_found" } as const;
    }

    const subgraph = await selectActiveSubgraphByGraphIdAndSlugForUpdate(
      transaction,
      graph.id,
      request.params.subgraphSlug,
    );
    if (!subgraph) {
      return { kind: "not_found" } as const;
    }

    const activeSubgraphs = await selectActiveSubgraphsByGraphId(transaction, graph.id);
    const existingSelections = await loadActiveSchemaRevisionMap(transaction, graph);
    const validationResult = await dryRunSubgraphSchemaComposition(
      activeSubgraphs,
      subgraph.id,
      normalizedSdl,
      existingSelections,
    );

    if (validationResult.kind === "invalid") {
      return {
        kind: "invalid",
        diagnostics: validationResult.diagnostics,
      } as const;
    }

    return {
      kind: "valid",
      payload: buildValidatePayload(validationResult.diagnostics),
    } as const;
  });

  switch (result.kind) {
    case "not_found":
      return reply.problemDetails({ status: 404 });
    case "invalid":
      return reply.code(422).type("application/problem+json").send({
        type: "about:blank",
        title: "Unprocessable Entity",
        status: 422,
        diagnostics: result.diagnostics,
      });
    case "valid":
      return reply.code(200).send(result.payload);
    default:
      throw new Error("Unexpected validate result kind.");
  }
};
