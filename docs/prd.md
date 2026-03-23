# GraphQL Schema Registry PRD

## Summary

This project is intended to be a GraphQL federation schema registry service. It should let platform administrators manage graphs and subgraphs, let subgraph owners publish SDL revisions, compose a current supergraph, and let graph consumers fetch the latest successful supergraph.

Today, the repository only implements the metadata-management foundation for graphs and subgraphs. The target product described below is based on the source product documentation, adjusted to reflect what this repository already has.

## Product goals

- Provide a stable HTTP API for managing federated graphs and subgraphs.
- Persist graph metadata, subgraph metadata, subgraph revisions, active revisions, and the latest successful supergraph.
- Support dry-run schema publication for validation and CI feedback.
- Support synchronous publish attempts that store revisions and promote them when composition succeeds.
- Serve the latest successful supergraph SDL with cache validation headers.
- Enforce JWT-based authorization with graph- and subgraph-scoped access.

## Primary users

- Platform administrators managing graphs and subgraphs.
- Subgraph publishers shipping schema changes.
- Routers or gateways fetching the composed supergraph.

## In scope for the target product

- Graph lifecycle management:
  - create, update, list, fetch, and soft-delete graphs
  - store and validate graph federation version
- Subgraph lifecycle management:
  - create, update, list, fetch, and soft-delete subgraphs
  - store current routing URL
- Schema publication:
  - accept raw SDL uploads for a graph/subgraph
  - canonicalize and hash SDL
  - append immutable subgraph revisions
  - support `dry-run=true`
- Composition:
  - maintain active subgraph revision pointers
  - iteratively promote latest compatible revisions
  - persist the latest successful supergraph SDL
  - compute schema change reports between supergraph revisions
- Supergraph serving:
  - return current supergraph SDL as `text/plain`
  - support cache revalidation with `ETag` and `If-None-Match`
- Auth and operability:
  - verify JWTs using configured issuer, audience, and JWKS/public key material
  - expose public health endpoints
  - return consistent RFC 7807 Problem Details for non-health failures
  - include request IDs in responses

## Explicitly out of scope

- End-user UI
- Token minting or auth provider management
- Background queues or asynchronous composition workers
- Multi-variant graph management inside one graph identifier
- Advanced search across combinations of pending subgraph revisions

## Functional requirements

### Graph management

- The service must manage graphs identified by a slug or graph identifier.
- Each graph must track a mutable revision counter and a federation version.
- Graph deletion must be soft delete.
- Deleted graph identifiers should remain reserved.

### Subgraph management

- The service must manage subgraphs under a graph, identified by subgraph slug.
- Each subgraph must track a mutable revision counter and routing URL.
- Subgraph deletion must be soft delete.
- Deleted subgraph identifiers should remain reserved within their graph.

### Schema publication and composition

- Subgraph owners must be able to submit SDL for a specific graph and subgraph.
- The service must validate and canonicalize SDL before persistence decisions.
- Dry-run publication must perform validation and composition checks without persistence.
- Non-dry-run publication must store a new immutable revision unless the canonical SDL hash is unchanged.
- The service must try to promote newly stored revisions into the active set using a deterministic algorithm.
- The service must persist only the latest successful supergraph, not a full supergraph history.

### Read APIs

- Admins must be able to list and fetch graphs and subgraphs.
- Graph-scoped clients must be able to fetch the current supergraph SDL.
- The service should expose enough metadata in responses for optimistic concurrency and debugging.

## Non-functional requirements

- Deterministic composition order and promotion behavior.
- Transactional persistence around graph/subgraph metadata mutations.
- Clear caller-actionable error responses for validation and composition failures.
- Compatibility-oriented API behavior so clients can depend on stable status codes and payloads.

## Current implementation baseline

The repository currently satisfies only part of the target product:

- Implemented:
  - graph CRUD metadata API
  - subgraph CRUD metadata API
  - soft deletes
  - revision counters for graph and subgraph metadata
  - JWT verification from a configured public key file
  - authorization grants for `admin`, `graph:read`, and `subgraph:write`
  - ETag-based optimistic concurrency on existing CRUD endpoints
  - `/health` endpoint
- Not yet implemented:
  - schema publish endpoint
  - supergraph fetch endpoint
  - active revision pointers
  - persisted supergraph rows
  - SDL canonicalization and hashing
  - federation composition
  - graph-scoped authorization on read endpoints
  - health endpoints and error semantics described in the external product docs

## Success criteria

- Admins can manage graphs and subgraphs without direct database access.
- Subgraph publishers can validate and publish SDL changes through the API.
- Compatible revisions become active automatically when composition succeeds.
- Routers can retrieve the latest successful supergraph reliably.
- The repository’s implementation and local docs no longer diverge on the core product contract.
