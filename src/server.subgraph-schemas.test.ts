import assert from "node:assert/strict";
import test from "node:test";

import { createAuthJwtSigner } from "./domain/jwt-signer.ts";
import { assertProblemResponse } from "./server.route.test-support.ts";
import { createFastifyServer } from "./server.ts";

const getSubgraphSchemaRequest = {
  method: "GET",
  url: "/v1/graphs/graph-1/subgraphs/products/schema.graphqls",
} as const;

await test("server: subgraph schema routes", async (t) => {
  let server: ReturnType<typeof createFastifyServer>;

  const { jwtVerification } = createAuthJwtSigner();

  t.beforeEach(async () => {
    server = createFastifyServer({
      jwtVerification,
    });
    await server.ready();
  });

  t.afterEach(async () => {
    await server.close();
  });

  await t.test(
    "GET /v1/graphs/:graphSlug/subgraphs/:subgraphSlug/schema.graphqls returns 401 without auth",
    async () => {
      const response = await server.inject(getSubgraphSchemaRequest);

      assertProblemResponse(response, 401, "Unauthorized");
      assert.equal(response.headers["www-authenticate"], "Bearer");
    },
  );
});
