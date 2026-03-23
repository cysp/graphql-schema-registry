# Remaining Product Requirement Questions

## Contract direction

- Is the target public API for this repository the current CRUD contract, or the more advanced contract?
- If the target is the advanced contract, should the existing `POST` create endpoints remain for backward compatibility, or should the service move fully to `PUT` upserts?

## Naming and identifiers

- Should `graphSlug` and `graphId` mean the same externally, or should one naming scheme be removed from the product contract?
- Should `subgraphSlug` and `subgraphId` likewise be unified?

## Authorization

- Should the product adopt exact string scopes like `graph:<graphId>` and `subgraph:<graphId>:<subgraphId>`, or keep the current `authorization_details` model with `graph:read` and `subgraph:write` plus structured ids?
- Is `admin` intended to remain an override for every route in the final product?
- Should `/user/grants` remain part of the product surface, or is it only a local development/debugging endpoint?

## Health and operability

- Should the final product expose `/health`, `/healthz/live`, and `/healthz/ready`, or only the healthz endpoints from the external docs?
- Should readiness remain a lightweight database probe only, or include composition-related dependencies later?

## Graph and subgraph lifecycle semantics

- When a graph or subgraph has been soft-deleted, should reads return `404` or `410`?
- For deleted identifiers, should create/upsert return `409`, `410`, or some other explicit reserved-name error?
- On graph delete, should all subgraphs be soft-deleted immediately, or should some historical subgraph state remain independently queryable?

## Schema publish semantics

- Should a publish that stores a revision but cannot promote it always return `202`, or are there cases where `422` is preferred after persistence?
- How much diagnostic detail is required in successful `202` responses?
- Should the service store publish-time diagnostics for later inspection, or only return them inline?

## Data retention

- Is keeping only the latest successful supergraph sufficient, or is historical supergraph retention needed for rollback, audit, or debugging?
- Do product requirements require retention or pruning rules for subgraph revision history?
