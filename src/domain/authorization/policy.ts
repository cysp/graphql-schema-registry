import type { AuthorizationGrant } from "./user.ts";

export type ManagedGraphFilter =
  | {
      kind: "all";
    }
  | {
      kind: "ids";
      graphIds: ReadonlySet<string>;
    };

function matchesResourceId(grantedId: string, requiredId: string): boolean {
  return grantedId === "*" || grantedId === requiredId;
}

export function canCreateGraph(grants: readonly AuthorizationGrant[]): boolean {
  return grants.some((grant) => grant.scope === "graph:manage" && grant.graphId === "*");
}

export function managedGraphFilter(grants: readonly AuthorizationGrant[]): ManagedGraphFilter {
  const graphManageGrants = grants.filter((grant) => grant.scope === "graph:manage");
  if (graphManageGrants.some((grant) => grant.graphId === "*")) {
    return {
      kind: "all",
    };
  }

  return {
    kind: "ids",
    graphIds: new Set(graphManageGrants.map((grant) => grant.graphId)),
  };
}

export function canManageGraph(grants: readonly AuthorizationGrant[], graphId: string): boolean {
  return grants.some(
    (grant) => grant.scope === "graph:manage" && matchesResourceId(grant.graphId, graphId),
  );
}

export function canReadSupergraphSchema(
  grants: readonly AuthorizationGrant[],
  graphId: string,
): boolean {
  return grants.some(
    (grant) =>
      grant.scope === "supergraph_schema:read" && matchesResourceId(grant.graphId, graphId),
  );
}

export function canReadSubgraphSchema(
  grants: readonly AuthorizationGrant[],
  graphId: string,
  subgraphId: string,
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
  graphId: string,
  subgraphId: string,
): boolean {
  return grants.some(
    (grant) =>
      grant.scope === "subgraph_schema:write" &&
      matchesResourceId(grant.graphId, graphId) &&
      matchesResourceId(grant.subgraphId, subgraphId),
  );
}
