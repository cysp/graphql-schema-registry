// oxlint-disable eslint-plugin-node/no-process-env

import assert from "node:assert/strict";
import test from "node:test";

import { authorizationDetailsType } from "./domain/authorization/details.ts";
import { createAuthJwtSigner } from "./domain/jwt-signer.ts";
import { zGraphListRoot, zGraphRoot } from "./lib/openapi-ts/zod.gen.ts";
import { createFastifyServer } from "./server.ts";
import { connectIntegrationDatabase } from "./test-support/database.ts";

function parseJson(response: { body: string }): unknown {
  return JSON.parse(response.body) as unknown;
}

function adminHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
  };
}

function adminRevisionHeaders(token: string, revisionId: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "x-revision-id": revisionId,
  };
}

await test("graph routes integration with postgres", async (t) => {
  const integrationDatabaseUrlFromEnv = process.env["INTEGRATION_TEST_DATABASE_URL"]?.trim();
  if (integrationDatabaseUrlFromEnv === undefined || integrationDatabaseUrlFromEnv === "") {
    t.skip("INTEGRATION_TEST_DATABASE_URL is not configured");
    return;
  }
  const integrationDatabaseUrl = integrationDatabaseUrlFromEnv;

  const jwtSigner = createAuthJwtSigner();
  const adminToken = jwtSigner.createToken({
    authorization_details: [
      {
        scope: "admin",
        type: authorizationDetailsType,
      },
    ],
  });

  await t.test("supports full graph CRUD flow", async () => {
    const integrationDatabase = await connectIntegrationDatabase(integrationDatabaseUrl);
    const server = createFastifyServer({
      database: integrationDatabase.database.database,
      jwtVerification: jwtSigner.jwtVerification,
    });

    try {
      await server.ready();

      const emptyListResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs",
      });
      assert.strictEqual(emptyListResponse.statusCode, 200);
      assert.deepStrictEqual(zGraphListRoot.parse(parseJson(emptyListResponse)), []);

      const createGraphResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "POST",
        payload: {
          federationVersion: "2.9",
          graphSlug: "catalog",
        },
        url: "/v1/graphs",
      });
      assert.strictEqual(createGraphResponse.statusCode, 201);
      const createdGraph = zGraphRoot.parse(parseJson(createGraphResponse));
      assert.strictEqual(createdGraph.revisionId, "1");
      assert.strictEqual(createdGraph.federationVersion, "2.9");

      const duplicateCreateResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "POST",
        payload: {
          federationVersion: "2.9",
          graphSlug: "catalog",
        },
        url: "/v1/graphs",
      });
      assert.strictEqual(duplicateCreateResponse.statusCode, 409);

      const getGraphResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs/catalog",
      });
      assert.strictEqual(getGraphResponse.statusCode, 200);
      assert.deepStrictEqual(zGraphRoot.parse(parseJson(getGraphResponse)), createdGraph);

      const updateGraphResponse = await server.inject({
        headers: adminRevisionHeaders(adminToken, "1"),
        method: "PUT",
        payload: {
          federationVersion: "2.10",
        },
        url: "/v1/graphs/catalog",
      });
      assert.strictEqual(updateGraphResponse.statusCode, 200);
      const updatedGraph = zGraphRoot.parse(parseJson(updateGraphResponse));
      assert.strictEqual(updatedGraph.id, createdGraph.id);
      assert.strictEqual(updatedGraph.revisionId, "2");
      assert.strictEqual(updatedGraph.federationVersion, "2.10");

      const staleUpdateResponse = await server.inject({
        headers: adminRevisionHeaders(adminToken, "1"),
        method: "PUT",
        payload: {
          federationVersion: "2.11",
        },
        url: "/v1/graphs/catalog",
      });
      assert.strictEqual(staleUpdateResponse.statusCode, 409);

      const unsafeRevisionResponse = await server.inject({
        headers: adminRevisionHeaders(adminToken, "9007199254740992"),
        method: "PUT",
        payload: {
          federationVersion: "2.11",
        },
        url: "/v1/graphs/catalog",
      });
      assert.strictEqual(unsafeRevisionResponse.statusCode, 400);

      const nonNumericRevisionResponse = await server.inject({
        headers: adminRevisionHeaders(adminToken, "not-a-number"),
        method: "PUT",
        payload: {
          federationVersion: "2.11",
        },
        url: "/v1/graphs/catalog",
      });
      assert.strictEqual(nonNumericRevisionResponse.statusCode, 400);

      const missingRevisionResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "PUT",
        payload: {
          federationVersion: "2.11",
        },
        url: "/v1/graphs/catalog",
      });
      assert.strictEqual(missingRevisionResponse.statusCode, 400);

      const listAfterUpdateResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs",
      });
      assert.strictEqual(listAfterUpdateResponse.statusCode, 200);
      assert.deepStrictEqual(zGraphListRoot.parse(parseJson(listAfterUpdateResponse)), [
        updatedGraph,
      ]);

      const deleteGraphResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "DELETE",
        url: "/v1/graphs/catalog",
      });
      assert.strictEqual(deleteGraphResponse.statusCode, 204);

      const deletedGetResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs/catalog",
      });
      assert.strictEqual(deletedGetResponse.statusCode, 404);

      const deletedListResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs",
      });
      assert.strictEqual(deletedListResponse.statusCode, 200);
      assert.deepStrictEqual(zGraphListRoot.parse(parseJson(deletedListResponse)), []);

      const missingDeleteResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "DELETE",
        url: "/v1/graphs/catalog",
      });
      assert.strictEqual(missingDeleteResponse.statusCode, 204);
    } finally {
      await server.close();
      await integrationDatabase.close();
    }
  });

  await t.test("returns expected statuses for missing graphs", async () => {
    const integrationDatabase = await connectIntegrationDatabase(integrationDatabaseUrl);
    const server = createFastifyServer({
      database: integrationDatabase.database.database,
      jwtVerification: jwtSigner.jwtVerification,
    });

    try {
      await server.ready();

      const getResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs/missing",
      });
      assert.strictEqual(getResponse.statusCode, 404);

      const updateResponse = await server.inject({
        headers: adminRevisionHeaders(adminToken, "1"),
        method: "PUT",
        payload: {
          federationVersion: "2.10",
        },
        url: "/v1/graphs/missing",
      });
      assert.strictEqual(updateResponse.statusCode, 404);

      const deleteResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "DELETE",
        url: "/v1/graphs/missing",
      });
      assert.strictEqual(deleteResponse.statusCode, 204);
    } finally {
      await server.close();
      await integrationDatabase.close();
    }
  });
});
