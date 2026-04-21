import type { AuthorizationGrant } from "./user.ts";

function matchesResourceId(grantedId: string, requiredId: string | undefined): boolean {
  if (requiredId === undefined) {
    return grantedId === "*";
  }

  return grantedId === "*" || grantedId === requiredId;
}

export function canManageAnyGraph(grants: readonly AuthorizationGrant[]): boolean {
  return grants.some((grant) => grant.scope === "graph:manage" && grant.graphId === "*");
}

export function canCreateGraph(grants: readonly AuthorizationGrant[]): boolean {
  return canManageAnyGraph(grants);
}

export function canManageGraph(
  grants: readonly AuthorizationGrant[],
  graphId: string | undefined,
): boolean {
  return grants.some(
    (grant) => grant.scope === "graph:manage" && matchesResourceId(grant.graphId, graphId),
  );
}

export function canReadSupergraphSchema(
  grants: readonly AuthorizationGrant[],
  graphId: string | undefined,
): boolean {
  return grants.some(
    (grant) =>
      grant.scope === "supergraph_schema:read" && matchesResourceId(grant.graphId, graphId),
  );
}

export function canReadSubgraphSchema(
  grants: readonly AuthorizationGrant[],
  graphId: string | undefined,
  subgraphId: string | undefined,
): boolean {
  return grants.some(
    (grant) =>
      grant.scope === "subgraph_schema:read" &&
      matchesResourceId(grant.graphId, graphId) &&
      matchesResourceId(grant.subgraphId, subgraphId),
  );
}

export function canWriteSubgraphSchema(
  grants: readonly AuthorizationGrant[],
  graphId: string | undefined,
  subgraphId: string | undefined,
): boolean {
  return grants.some(
    (grant) =>
      grant.scope === "subgraph_schema:write" &&
      matchesResourceId(grant.graphId, graphId) &&
      matchesResourceId(grant.subgraphId, subgraphId),
  );
}

export function canValidateSubgraphSchema(
  grants: readonly AuthorizationGrant[],
  graphId: string | undefined,
  subgraphId: string | undefined,
): boolean {
  return grants.some(
    (grant) =>
      (grant.scope === "subgraph_schema:validate" || grant.scope === "subgraph_schema:write") &&
      matchesResourceId(grant.graphId, graphId) &&
      matchesResourceId(grant.subgraphId, subgraphId),
  );
}
