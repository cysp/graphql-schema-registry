# Outstanding TODOs

## Highest priority

- Implement schema publish endpoint: `POST /v1/graphs/:graphId/subgraphs/:subgraphId/schema.graphqls`.
- Implement supergraph fetch endpoint: `GET /v1/graphs/:graphId/supergraph.graphqls`.
- Add persistence for `subgraph_active_revisions` and `supergraphs`.
- Extend `subgraph_revisions` to store canonical SDL and canonical hash.
- Integrate Apollo federation validation and composition.
- Implement deterministic active-set promotion and final supergraph persistence.

## API and contract alignment

- Decide whether this repository should move to the target `PUT`-oriented API contract or continue with the current CRUD contract and document that divergence.
- Align auth scope semantics with the intended product contract.
- Add graph-scoped authorization for supergraph reads.
- Add subgraph-scoped authorization for schema publication.
- Align health endpoints with the intended product contract, or explicitly document `/health` as the chosen local contract.
- Align environment configuration with the intended JWKS-based contract, or explicitly keep the simpler public-key-file approach.

## Persistence and domain model

- Add migrations/schema updates for new registry tables and columns.
- Define and implement reserved-ID behavior for deleted graphs and subgraphs in a way that matches the final API contract.
- Decide whether graph and subgraph identifiers are called `slug`, `graphId`, and `subgraphId` interchangeably or should be normalized in code and docs.
- Persist only the latest successful supergraph, or intentionally store history if the product needs it.

## Error and response behavior

- Finalize the Problem Details code taxonomy for validation, conflict, auth, and internal errors.
- Implement caller-visible diagnostics for federation validation and composition failures.
- Define precise `201` vs `202` vs `200` semantics for schema publish outcomes.
- Define `404` vs `410` vs `409` behavior for missing, deleted, and reserved resources.

## OpenAPI and docs

- Update local OpenAPI to match the final intended product contract.
- Keep generated Fastify route types in sync with the chosen OpenAPI contract.
- Add local architecture notes once composition logic exists.
- Add examples for publish, dry-run, and supergraph fetch flows.

## Validation and testing

- Add end-to-end tests for schema dry-run and publish flows.
- Add deterministic promotion/composition tests for cross-subgraph scenarios.
- Add tests for supergraph caching headers and conditional requests.
- Add tests for deleted-resource semantics and reserved-ID conflicts.
- Add tests for graph-scoped and subgraph-scoped authorization behavior.
