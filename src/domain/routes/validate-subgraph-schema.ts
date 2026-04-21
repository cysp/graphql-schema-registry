import { composeServices } from "@apollo/composition";
import { parse } from "graphql";

import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAuthenticatedUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { canValidateSubgraphSchema } from "../authorization/policy.ts";
import {
  selectGraphCompositionServiceDefinitions,
  selectSubgraphsEligibleForGraphComposition,
} from "../database/graph-compositions/repository.ts";
import { selectActiveGraphBySlug } from "../database/graphs/repository.ts";
import { selectCurrentSubgraphSchemaRevision } from "../database/subgraph-schemas/repository.ts";
import { selectActiveSubgraphByGraphIdAndSlug } from "../database/subgraphs/repository.ts";
import {
  analyzeComposedSchemaChanges,
  createCompositionFailureAnalysis,
  normalizeCompositionErrors,
  type ValidateSubgraphSchemaAnalysis,
} from "../subgraph-schema-change-analysis.ts";
import { etagSatisfiesIfMatch, formatStrongETag, parseIfMatchHeader } from "../etag.ts";
import { normalizeSchemaSdl } from "../subgraph-schema.ts";

type OperationHandlers = OpenApiOperationHandlers<
  keyof typeof operationRouteDefinitions,
  typeof operationRouteDefinitions
>;

type RouteDependencies = {
  database: PostgresJsDatabase | undefined;
};

type SubgraphServiceDefinition = {
  subgraphId: string;
  slug: string;
  routingUrl: string;
  normalizedSdl: string;
};

function composeSubgraphServices(subgraphDefinitions: ReadonlyArray<SubgraphServiceDefinition>) {
  return composeServices(
    subgraphDefinitions.map((definition) => ({
      name: definition.slug,
      typeDefs: parse(definition.normalizedSdl),
      url: definition.routingUrl,
    })),
  );
}

function createCandidateServiceDefinitions({
  eligibleSubgraphs,
  proposedNormalizedSdl,
  targetSubgraph,
}: {
  eligibleSubgraphs: ReadonlyArray<SubgraphServiceDefinition>;
  proposedNormalizedSdl: string;
  targetSubgraph: Pick<SubgraphServiceDefinition, "subgraphId" | "slug" | "routingUrl">;
}): SubgraphServiceDefinition[] {
  const replacedSubgraphDefinitions = eligibleSubgraphs.map((subgraph) =>
    subgraph.subgraphId === targetSubgraph.subgraphId
      ? {
          ...subgraph,
          normalizedSdl: proposedNormalizedSdl,
        }
      : subgraph,
  );

  if (
    replacedSubgraphDefinitions.some(
      (subgraph) => subgraph.subgraphId === targetSubgraph.subgraphId,
    )
  ) {
    return replacedSubgraphDefinitions;
  }

  return [
    ...replacedSubgraphDefinitions,
    {
      subgraphId: targetSubgraph.subgraphId,
      slug: targetSubgraph.slug,
      routingUrl: targetSubgraph.routingUrl,
      normalizedSdl: proposedNormalizedSdl,
    },
  ].toSorted((left, right) => left.slug.localeCompare(right.slug) || left.subgraphId.localeCompare(right.subgraphId));
}

function createBaselineServiceDefinitions(
  baselineSubgraphs: ReadonlyArray<SubgraphServiceDefinition>,
): SubgraphServiceDefinition[] {
  return baselineSubgraphs.toSorted(
    (left, right) => left.slug.localeCompare(right.slug) || left.subgraphId.localeCompare(right.subgraphId),
  );
}

export const validateSubgraphSchemaHandler: DependencyInjectedHandler<
  OperationHandlers["validateSubgraphSchema"],
  RouteDependencies
> = async ({ dependencies: { database }, request, reply }) => {
  const user = requireAuthenticatedUser(request, reply);
  if (!user) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  let normalizedSdl: string;
  try {
    normalizedSdl = normalizeSchemaSdl(request.body);
  } catch (error) {
    request.log.warn({ error }, "invalid subgraph schema validation payload");
    return reply.problemDetails({ status: 422 });
  }

  const ifMatch = parseIfMatchHeader(request.headers["if-match"]);

  const graph = await selectActiveGraphBySlug(database, request.params.graphSlug);
  let subgraph;
  if (graph) {
    subgraph = await selectActiveSubgraphByGraphIdAndSlug(
      database,
      graph.id,
      request.params.subgraphSlug,
    );
  }

  if (!canValidateSubgraphSchema(user.grants, graph?.id, subgraph?.id)) {
    return reply.problemDetails({ status: 403 });
  }

  if (!graph || !subgraph) {
    if (!etagSatisfiesIfMatch(ifMatch, undefined)) {
      return reply.problemDetails({ status: 412 });
    }

    return reply.problemDetails({ status: 404 });
  }

  const currentSchemaRevision = await selectCurrentSubgraphSchemaRevision(database, subgraph.id);
  const currentEtag =
    currentSchemaRevision && formatStrongETag(subgraph.id, currentSchemaRevision.revision);

  if (!etagSatisfiesIfMatch(ifMatch, currentEtag)) {
    return reply.problemDetails({ status: 412 });
  }

  const eligibleSubgraphs = await selectSubgraphsEligibleForGraphComposition(database, graph.id);
  const candidateServices = createCandidateServiceDefinitions({
    eligibleSubgraphs,
    proposedNormalizedSdl: normalizedSdl,
    targetSubgraph: {
      subgraphId: subgraph.id,
      slug: subgraph.slug,
      routingUrl: subgraph.routingUrl,
    },
  });

  const candidateComposition = composeSubgraphServices(candidateServices);

  let baselineAnalysisSchema;
  if (graph.currentSupergraphSchemaRevision !== null) {
    const baselineSubgraphs = await selectGraphCompositionServiceDefinitions(
      database,
      graph.id,
      graph.currentSupergraphSchemaRevision,
    );

    const baselineComposition = composeSubgraphServices(
      createBaselineServiceDefinitions(baselineSubgraphs),
    );
    if (baselineComposition.errors) {
      request.log.error(
        {
          errors: normalizeCompositionErrors(baselineComposition.errors),
          graphId: graph.id,
          graphSlug: graph.slug,
          revision: graph.currentSupergraphSchemaRevision,
        },
        "failed to compose baseline supergraph schema during subgraph validation",
      );

      return reply.problemDetails({ status: 500 });
    }

    baselineAnalysisSchema = baselineComposition.schema.toAPISchema().toGraphQLJSSchema();
  }

  if (candidateComposition.errors) {
    const compositionErrors = normalizeCompositionErrors(candidateComposition.errors);
    const analysis: ValidateSubgraphSchemaAnalysis = createCompositionFailureAnalysis({
      baselineAvailable: baselineAnalysisSchema !== undefined,
      compositionErrors,
    });

    return reply.code(200).send(analysis);
  }

  const candidateAnalysisSchema = candidateComposition.schema.toAPISchema().toGraphQLJSSchema();

  const analysis = analyzeComposedSchemaChanges({
    baselineSchema: baselineAnalysisSchema,
    candidateSchema: candidateAnalysisSchema,
  });

  return reply.code(200).send(analysis);
};
