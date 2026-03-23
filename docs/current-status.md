# Current Status

## Overall assessment

This repository is an early implementation of the target schema registry. It has a solid base for graph and subgraph metadata management, but it does not yet implement the core schema-registry behavior described in the external product documentation.

The biggest distinction is simple:

- Current repository: CRUD service for graph/subgraph metadata with revisions, soft deletes, JWT auth, and ETag concurrency.
- Target product: schema registry with schema publication, composition, active revision planning, and supergraph serving.

## What exists today

### API surface

Implemented routes:

- `GET /health`
- `GET /user/grants`
- `GET /v1/graphs`
- `POST /v1/graphs`
- `GET /v1/graphs/:graphSlug`
- `PUT /v1/graphs/:graphSlug`
- `DELETE /v1/graphs/:graphSlug`
- `GET /v1/graphs/:graphSlug/subgraphs`
- `POST /v1/graphs/:graphSlug/subgraphs`
- `GET /v1/graphs/:graphSlug/subgraphs/:subgraphSlug`
- `PUT /v1/graphs/:graphSlug/subgraphs/:subgraphSlug`
- `DELETE /v1/graphs/:graphSlug/subgraphs/:subgraphSlug`

Notes:

- The current API is CRUD-oriented.
- It uses `POST` to create graphs and subgraphs, while the external target docs describe `PUT`-based upsert semantics.
- There is no publish endpoint and no supergraph read endpoint.

### Persistence model

Implemented tables:

- `graphs`
- `graph_revisions`
- `subgraphs`
- `subgraph_revisions`

Implemented behavior:

- soft delete for graphs and subgraphs
- reserved uniqueness only for active rows
- revision history for graph federation version changes
- revision history for subgraph routing URL changes

Missing persistence for target state:

- `subgraph_active_revisions`
- `supergraphs`
- canonical SDL storage and hash fields on subgraph revisions
- any stored composition diagnostics or publish outcome state

### Authorization

Current authorization model:

- all non-health routes require a bearer token when JWT verification is configured
- admin-only protection is enforced on graph and subgraph CRUD routes
- parsed grants are:
  - `admin`
  - `graph:read`
  - `subgraph:write`

Gap to target:

- target docs require exact scopes shaped like `graph:<graphId>` and `subgraph:<graphId>:<subgraphId>`
- current implementation does not use graph-scoped auth for any route
- current implementation does not allow subgraph-scoped callers to publish schemas because publish does not exist yet

### Operational behavior

- Health endpoint is `/health`, not `/healthz/live` and `/healthz/ready`.
- Health payload includes per-probe status and returns `200` for warn state.
- Errors use Problem Details helpers, but current product docs assume a more specific error taxonomy and broader status behavior.
- Env configuration uses `AUTH_JWT_PUBLIC_KEY_PATH`, `AUTH_JWT_ISSUER`, and `AUTH_JWT_AUDIENCE`, not JWKS-based config.

## Major gaps to target state

### Missing core capabilities

- raw SDL publish API
- dry-run composition validation
- canonical SDL generation and hashing
- composition engine integration
- active-set promotion algorithm
- current supergraph persistence
- current supergraph fetch API
- schema change reporting

### Contract mismatches

- health endpoint shape and URLs differ
- auth scope contract differs
- environment contract differs
- API style differs:
  - current spec uses `POST` create endpoints
  - external docs describe `PUT` upsert endpoints
- delete semantics differ:
  - current delete behavior is effectively idempotent `204` on missing resources when `If-Match` allows it
  - external docs more often distinguish never-existed, deleted, and reserved identifiers

### Documentation drift

- The external docs in the hackery repository describe a more advanced, implementation-aligned product than this repository currently implements.
- The local OpenAPI spec represents the current CRUD API, not the target schema-registry contract from the external docs.

## Recommended target framing

The most accurate way to understand this repository is:

- It is a foundation for a schema registry, not yet a complete schema registry.
- The target behavior is well described in the external docs.
- The local implementation needs both feature work and contract decisions before it can claim compatibility with that target.
