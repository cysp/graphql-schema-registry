import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

function generatedPath(relativePath: string): string {
  return path.resolve(process.cwd(), "src/lib/fastify/openapi/generated", relativePath);
}

async function readGenerated(relativePath: string): Promise<string> {
  return readFile(generatedPath(relativePath), "utf8");
}

await test("generated output uses fastify-aligned operation naming", async (t) => {
  await t.test("updateGraph operation file exports fastify key-aligned schema names", async () => {
    const source = await readGenerated("operations/update-graph.ts");

    assert.match(source, /export const updateGraphParamsSchema = /);
    assert.match(source, /export const updateGraphHeadersSchema = /);
    assert.match(source, /export const updateGraphBodySchema = /);
    assert.match(source, /export const updateGraphRouteSchema = \{/);
    assert.match(source, /params: updateGraphParamsSchema,/);
    assert.match(source, /headers: updateGraphHeadersSchema,/);
    assert.match(source, /body: updateGraphBodySchema,/);
    assert.match(source, /response: \{[\s\S]*200:[\s\S]*400:[\s\S]*401:/);
    assert.doesNotMatch(source, /updateGraphResponse200Schema/);
  });

  await t.test("fastify routes registry references operation route definitions", async () => {
    const source = await readGenerated("route-definitions.ts");

    assert.match(source, /export const fastifyRouteDefinitionsByOperationId = \{/);
    assert.match(source, /listGraphs: listGraphsFastifyRouteDefinition,/);
    assert.match(source, /updateSubgraph: updateSubgraphFastifyRouteDefinition,/);
  });
});
