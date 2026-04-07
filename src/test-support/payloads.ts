import assert from "node:assert/strict";

import type { GraphPayload, SubgraphPayload } from "../domain/routes/payloads.ts";

export type { GraphPayload, SubgraphPayload } from "../domain/routes/payloads.ts";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireStringProperty(record: Record<string, unknown>, propertyName: string): string {
  const propertyValue = record[propertyName];
  if (typeof propertyValue !== "string") {
    throw new assert.AssertionError({
      actual: propertyValue,
      expected: "string",
      message: `Expected ${propertyName} to be a string.`,
      operator: "===",
    });
  }

  return propertyValue;
}

export function requireGraphPayload(value: unknown): GraphPayload {
  assert.ok(isObjectRecord(value), "Expected graph payload to be an object.");

  return {
    createdAt: requireStringProperty(value, "createdAt"),
    currentRevision: requireStringProperty(value, "currentRevision"),
    id: requireStringProperty(value, "id"),
    slug: requireStringProperty(value, "slug"),
    updatedAt: requireStringProperty(value, "updatedAt"),
  };
}

export function requireSubgraphPayload(value: unknown): SubgraphPayload {
  assert.ok(isObjectRecord(value), "Expected subgraph payload to be an object.");

  return {
    createdAt: requireStringProperty(value, "createdAt"),
    currentRevision: requireStringProperty(value, "currentRevision"),
    graphId: requireStringProperty(value, "graphId"),
    id: requireStringProperty(value, "id"),
    routingUrl: requireStringProperty(value, "routingUrl"),
    slug: requireStringProperty(value, "slug"),
    updatedAt: requireStringProperty(value, "updatedAt"),
  };
}
