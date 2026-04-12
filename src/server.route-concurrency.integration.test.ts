// oxlint-disable eslint-plugin-node/no-process-env,eslint-plugin-promise/prefer-await-to-callbacks,typescript-eslint/no-unsafe-assignment,typescript-eslint/no-unsafe-call,typescript-eslint/no-unsafe-member-access,typescript-eslint/no-unsafe-return

import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { authorizationDetailsType } from "./domain/authorization/details.ts";
import { formatStrongETag } from "./domain/etag.ts";
import { createAuthJwtSigner } from "./domain/jwt-signer.ts";
import { graphRevisions, subgraphRevisions, subgraphs } from "./drizzle/schema.ts";
import type { PostgresJsDatabase, PostgresJsTransaction } from "./drizzle/types.ts";
import { queryCount } from "./test-support/database.ts";
import { deferred } from "./test-support/deferred.ts";
import { createFailingDatabase } from "./test-support/failing-database.ts";
import type { IntegrationServerFixture } from "./test-support/integration-server.ts";
import {
  authorizationHeaders,
  authorizationIfMatchHeaders,
  parseJson,
  withConcurrentIntegrationServer,
} from "./test-support/integration-server.ts";
import { requireGraphPayload, requireSubgraphPayload } from "./test-support/payloads.ts";

async function assertPromiseStillPending<T>(promise: Promise<T>, waitMs = 25): Promise<void> {
  const state = await Promise.race([
    promise.then(
      () => "settled" as const,
      () => "settled" as const,
    ),
    delay(waitMs, "pending" as const),
  ]);
  assert.equal(state, "pending");
}

async function createGraphThroughApi(
  server: IntegrationServerFixture["server"],
  graphManageToken: string,
  slug = "catalog",
) {
  const response = await server.inject({
    headers: authorizationHeaders(graphManageToken),
    method: "POST",
    payload: {
      slug,
    },
    url: "/v1/graphs",
  });
  assert.equal(response.statusCode, 201);
  return requireGraphPayload(parseJson(response));
}

async function createSubgraphThroughApi(
  server: IntegrationServerFixture["server"],
  graphManageToken: string,
  graphSlug = "catalog",
  slug = "inventory",
  routingUrl = "https://inventory.example.com/graphql",
) {
  const response = await server.inject({
    headers: authorizationHeaders(graphManageToken),
    method: "POST",
    payload: {
      routingUrl,
      slug,
    },
    url: `/v1/graphs/${encodeURIComponent(graphSlug)}/subgraphs`,
  });
  assert.equal(response.statusCode, 201);
  return requireSubgraphPayload(parseJson(response));
}

function createSubgraphSchemaGrantToken(
  createToken: ReturnType<typeof createAuthJwtSigner>["createToken"],
  scope: "subgraph_schema:write",
  graphId: string,
  subgraphId: string,
) {
  return createToken({
    authorization_details: [
      {
        graph_id: graphId,
        scope,
        subgraph_id: subgraphId,
        type: authorizationDetailsType,
      },
    ],
  });
}

function createPostCallbackFailingDatabase(
  database: PostgresJsDatabase,
  error: Error,
): PostgresJsDatabase {
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property === "transaction") {
        return async (callback: (transaction: PostgresJsTransaction) => Promise<unknown>) =>
          target.transaction(async (transaction) => {
            await callback(transaction);
            throw error;
          });
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

await test("route handler concurrency and rollback integration with postgres", async (t) => {
  const integrationDatabaseUrl = process.env["INTEGRATION_TEST_DATABASE_URL"]?.trim();
  if (!integrationDatabaseUrl) {
    t.skip("INTEGRATION_TEST_DATABASE_URL is not configured");
    return;
  }

  const jwtSigner = createAuthJwtSigner();
  const createGraphManageToken = (): string =>
    jwtSigner.createToken({
      authorization_details: [
        {
          graph_id: "*",
          scope: "graph:manage",
          type: authorizationDetailsType,
        },
      ],
    });
  const { jwtVerification } = jwtSigner;

  await t.test("graph update waits for the lock and evaluates If-Match after commit", async () => {
    await withConcurrentIntegrationServer(
      {
        databaseUrl: integrationDatabaseUrl,
        jwtVerification,
      },
      async (fixture) => {
        const createdGraph = await createGraphThroughApi(fixture.server, createGraphManageToken());
        const session = await fixture.openSession();
        const release = deferred<undefined>();
        const locked = deferred<undefined>();

        const blocker = session.sql.begin(async (sql) => {
          const now = new Date();
          await sql.unsafe("SELECT id FROM graphs WHERE id = $1 FOR UPDATE", [createdGraph.id]);
          await sql.unsafe(
            `
            INSERT INTO graph_revisions (graph_id, revision, created_at)
            VALUES ($1, 2, $2)
          `,
            [createdGraph.id, now.toISOString()],
          );
          await sql.unsafe(
            `
            UPDATE graphs
            SET current_revision = 2, updated_at = $1
            WHERE id = $2
          `,
            [now.toISOString(), createdGraph.id],
          );
          locked.resolve(undefined);
          await release.promise;
        });

        await locked.promise;

        const responsePromise = fixture.server.inject({
          headers: authorizationIfMatchHeaders(
            createGraphManageToken(),
            formatStrongETag(createdGraph.id, 1),
          ),
          method: "PUT",
          payload: {},
          url: "/v1/graphs/catalog",
        });

        try {
          await assertPromiseStillPending(responsePromise);
        } finally {
          release.resolve(undefined);
          await blocker;
        }

        const response = await responsePromise;
        assert.equal(response.statusCode, 412);

        const [graphRow] = await fixture.sql<
          Array<{
            currentRevision: string;
          }>
        >`
          SELECT g.current_revision AS "currentRevision"
          FROM graphs AS g
          WHERE g.id = ${createdGraph.id}
        `;
        assert.deepEqual(graphRow, {
          currentRevision: "2",
        });
      },
    );
  });

  await t.test(
    "graph delete waits for the lock and soft-deletes graph and subgraphs together",
    async () => {
      await withConcurrentIntegrationServer(
        {
          databaseUrl: integrationDatabaseUrl,
          jwtVerification,
        },
        async (fixture) => {
          const createdGraph = await createGraphThroughApi(
            fixture.server,
            createGraphManageToken(),
          );
          await createSubgraphThroughApi(fixture.server, createGraphManageToken());
          const session = await fixture.openSession();
          const release = deferred<undefined>();
          const locked = deferred<undefined>();

          const blocker = session.sql.begin(async (sql) => {
            await sql.unsafe("SELECT id FROM graphs WHERE id = $1 FOR UPDATE", [createdGraph.id]);
            locked.resolve(undefined);
            await release.promise;
          });

          await locked.promise;

          const responsePromise = fixture.server.inject({
            headers: authorizationHeaders(createGraphManageToken()),
            method: "DELETE",
            url: "/v1/graphs/catalog",
          });

          try {
            await assertPromiseStillPending(responsePromise);
          } finally {
            release.resolve(undefined);
            await blocker;
          }

          const response = await responsePromise;
          assert.equal(response.statusCode, 204);
          assert.equal(
            await queryCount(
              fixture.sql,
              "SELECT count(*)::int AS count FROM graphs WHERE slug = 'catalog' AND deleted_at IS NULL",
            ),
            0,
          );
          assert.equal(
            await queryCount(
              fixture.sql,
              "SELECT count(*)::int AS count FROM subgraphs WHERE slug = 'inventory' AND deleted_at IS NULL",
            ),
            0,
          );
          assert.equal(
            await queryCount(
              fixture.sql,
              "SELECT count(*)::int AS count FROM graphs WHERE slug = 'catalog' AND deleted_at IS NOT NULL",
            ),
            1,
          );
          assert.equal(
            await queryCount(
              fixture.sql,
              "SELECT count(*)::int AS count FROM subgraphs WHERE slug = 'inventory' AND deleted_at IS NOT NULL",
            ),
            1,
          );
        },
      );
    },
  );

  await t.test(
    "subgraph create waits behind a graph delete and returns 404 from committed state",
    async () => {
      await withConcurrentIntegrationServer(
        {
          databaseUrl: integrationDatabaseUrl,
          jwtVerification,
        },
        async (fixture) => {
          const createdGraph = await createGraphThroughApi(
            fixture.server,
            createGraphManageToken(),
          );
          const session = await fixture.openSession();
          const release = deferred<undefined>();
          const locked = deferred<undefined>();

          const blocker = session.sql.begin(async (sql) => {
            const now = new Date();
            await sql.unsafe("SELECT id FROM graphs WHERE id = $1 FOR UPDATE", [createdGraph.id]);
            await sql.unsafe(
              `
              UPDATE graphs
              SET deleted_at = $1, updated_at = $2
              WHERE id = $3
            `,
              [now.toISOString(), now.toISOString(), createdGraph.id],
            );
            locked.resolve(undefined);
            await release.promise;
          });

          await locked.promise;

          const responsePromise = fixture.server.inject({
            headers: authorizationHeaders(createGraphManageToken()),
            method: "POST",
            payload: {
              routingUrl: "https://inventory.example.com/graphql",
              slug: "inventory",
            },
            url: "/v1/graphs/catalog/subgraphs",
          });

          try {
            await assertPromiseStillPending(responsePromise);
          } finally {
            release.resolve(undefined);
            await blocker;
          }

          const response = await responsePromise;
          assert.equal(response.statusCode, 404);
          assert.equal(
            await queryCount(
              fixture.sql,
              "SELECT count(*)::int AS count FROM subgraphs WHERE slug = 'inventory'",
            ),
            0,
          );
        },
      );
    },
  );

  await t.test(
    "subgraph create waits for graph revision changes and returns 412 for stale If-Match",
    async () => {
      await withConcurrentIntegrationServer(
        {
          databaseUrl: integrationDatabaseUrl,
          jwtVerification,
        },
        async (fixture) => {
          const createdGraph = await createGraphThroughApi(
            fixture.server,
            createGraphManageToken(),
          );
          const session = await fixture.openSession();
          const release = deferred<undefined>();
          const locked = deferred<undefined>();

          const blocker = session.sql.begin(async (sql) => {
            const now = new Date();
            await sql.unsafe("SELECT id FROM graphs WHERE id = $1 FOR UPDATE", [createdGraph.id]);
            await sql.unsafe(
              `
              INSERT INTO graph_revisions (graph_id, revision, created_at)
              VALUES ($1, 2, $2)
            `,
              [createdGraph.id, now.toISOString()],
            );
            await sql.unsafe(
              `
              UPDATE graphs
              SET current_revision = 2, updated_at = $1
              WHERE id = $2
            `,
              [now.toISOString(), createdGraph.id],
            );
            locked.resolve(undefined);
            await release.promise;
          });

          await locked.promise;

          const responsePromise = fixture.server.inject({
            headers: authorizationIfMatchHeaders(
              createGraphManageToken(),
              formatStrongETag(createdGraph.id, 1),
            ),
            method: "POST",
            payload: {
              routingUrl: "https://inventory.example.com/graphql",
              slug: "inventory",
            },
            url: "/v1/graphs/catalog/subgraphs",
          });

          try {
            await assertPromiseStillPending(responsePromise);
          } finally {
            release.resolve(undefined);
            await blocker;
          }

          const response = await responsePromise;
          assert.equal(response.statusCode, 412);
        },
      );
    },
  );

  await t.test(
    "subgraph update waits for the lock and evaluates If-Match after commit",
    async () => {
      await withConcurrentIntegrationServer(
        {
          databaseUrl: integrationDatabaseUrl,
          jwtVerification,
        },
        async (fixture) => {
          await createGraphThroughApi(fixture.server, createGraphManageToken());
          const createdSubgraph = await createSubgraphThroughApi(
            fixture.server,
            createGraphManageToken(),
          );
          const session = await fixture.openSession();
          const release = deferred<undefined>();
          const locked = deferred<undefined>();

          const blocker = session.sql.begin(async (sql) => {
            const now = new Date();
            await sql.unsafe("SELECT id FROM subgraphs WHERE id = $1 FOR UPDATE", [
              createdSubgraph.id,
            ]);
            await sql.unsafe(
              `
              INSERT INTO subgraph_revisions (subgraph_id, revision, routing_url, created_at)
              VALUES ($1, 2, 'https://inventory-v2.example.com/graphql', $2)
            `,
              [createdSubgraph.id, now.toISOString()],
            );
            await sql.unsafe(
              `
              UPDATE subgraphs
              SET current_revision = 2, updated_at = $1
              WHERE id = $2
            `,
              [now.toISOString(), createdSubgraph.id],
            );
            locked.resolve(undefined);
            await release.promise;
          });

          await locked.promise;

          const responsePromise = fixture.server.inject({
            headers: authorizationIfMatchHeaders(
              createGraphManageToken(),
              formatStrongETag(createdSubgraph.id, 1),
            ),
            method: "PUT",
            payload: {
              routingUrl: "https://inventory-v3.example.com/graphql",
            },
            url: "/v1/graphs/catalog/subgraphs/inventory",
          });

          try {
            await assertPromiseStillPending(responsePromise);
          } finally {
            release.resolve(undefined);
            await blocker;
          }

          const response = await responsePromise;
          assert.equal(response.statusCode, 412);

          const [subgraphRow] = await fixture.sql<
            Array<{
              currentRevision: string;
              routingUrl: string;
            }>
          >`
          SELECT sr.routing_url AS "routingUrl", s.current_revision AS "currentRevision"
          FROM subgraphs AS s
          JOIN subgraph_revisions AS sr
            ON sr.subgraph_id = s.id AND sr.revision = s.current_revision
          WHERE s.id = ${createdSubgraph.id}
        `;
          assert.deepEqual(subgraphRow, {
            currentRevision: "2",
            routingUrl: "https://inventory-v2.example.com/graphql",
          });
        },
      );
    },
  );

  await t.test(
    "list subgraphs waits behind a graph delete and returns the post-commit 404",
    async () => {
      await withConcurrentIntegrationServer(
        {
          databaseUrl: integrationDatabaseUrl,
          jwtVerification,
        },
        async (fixture) => {
          const createdGraph = await createGraphThroughApi(
            fixture.server,
            createGraphManageToken(),
          );
          await createSubgraphThroughApi(fixture.server, createGraphManageToken());
          const session = await fixture.openSession();
          const release = deferred<undefined>();
          const locked = deferred<undefined>();

          const blocker = session.sql.begin(async (sql) => {
            const now = new Date();
            await sql.unsafe("SELECT id FROM graphs WHERE id = $1 FOR UPDATE", [createdGraph.id]);
            await sql.unsafe(
              `
              UPDATE graphs
              SET deleted_at = $1, updated_at = $2
              WHERE id = $3
            `,
              [now.toISOString(), now.toISOString(), createdGraph.id],
            );
            locked.resolve(undefined);
            await release.promise;
          });

          await locked.promise;

          const responsePromise = fixture.server.inject({
            headers: authorizationHeaders(createGraphManageToken()),
            method: "GET",
            url: "/v1/graphs/catalog/subgraphs",
          });

          try {
            await assertPromiseStillPending(responsePromise);
          } finally {
            release.resolve(undefined);
            await blocker;
          }

          const response = await responsePromise;
          assert.equal(response.statusCode, 404);
        },
      );
    },
  );

  await t.test("graph create rolls back when initial graph revision creation fails", async () => {
    await withConcurrentIntegrationServer(
      {
        databaseFactory: (database) =>
          createFailingDatabase(database, {
            error: new Error("forced graph revision insert failure"),
            kind: "insert",
            table: graphRevisions,
          }),
        databaseUrl: integrationDatabaseUrl,
        jwtVerification,
      },
      async (fixture) => {
        const response = await fixture.server.inject({
          headers: authorizationHeaders(createGraphManageToken()),
          method: "POST",
          payload: {
            slug: "catalog",
          },
          url: "/v1/graphs",
        });

        assert.equal(response.statusCode, 500);
        assert.equal(await queryCount(fixture.sql, "SELECT count(*)::int AS count FROM graphs"), 0);
        assert.equal(
          await queryCount(fixture.sql, "SELECT count(*)::int AS count FROM graph_revisions"),
          0,
        );
      },
    );
  });

  await t.test(
    "subgraph schema publish waits for the lock and evaluates If-Match after commit",
    async () => {
      await withConcurrentIntegrationServer(
        {
          databaseUrl: integrationDatabaseUrl,
          jwtVerification,
        },
        async (fixture) => {
          const createdGraph = await createGraphThroughApi(
            fixture.server,
            createGraphManageToken(),
          );
          const createdSubgraph = await createSubgraphThroughApi(
            fixture.server,
            createGraphManageToken(),
          );
          const schemaWriteToken = createSubgraphSchemaGrantToken(
            jwtSigner.createToken,
            "subgraph_schema:write",
            createdGraph.id,
            createdSubgraph.id,
          );
          const session = await fixture.openSession();
          const release = deferred<undefined>();
          const locked = deferred<undefined>();

          const blocker = session.sql.begin(async (sql) => {
            const now = new Date();
            await sql.unsafe("SELECT id FROM subgraphs WHERE id = $1 FOR UPDATE", [
              createdSubgraph.id,
            ]);
            await sql.unsafe(
              `
              INSERT INTO subgraph_schema_revisions (subgraph_id, revision, normalized_sdl, created_at)
              VALUES ($1, 1, $2, $3)
            `,
              [createdSubgraph.id, "type Query {\n  products: [String!]!\n}\n", now.toISOString()],
            );
            await sql.unsafe(
              `
              UPDATE subgraphs
              SET current_schema_revision = 1, updated_at = $1
              WHERE id = $2
            `,
              [now.toISOString(), createdSubgraph.id],
            );
            locked.resolve(undefined);
            await release.promise;
          });

          await locked.promise;

          const responsePromise = fixture.server.inject({
            headers: {
              authorization: `Bearer ${schemaWriteToken}`,
              "content-type": "text/plain",
              "if-match": formatStrongETag(createdSubgraph.id, 0),
            },
            method: "POST",
            payload: "type Query { products: [String!]!, product(id: ID!): String }",
            url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
          });

          try {
            await assertPromiseStillPending(responsePromise);
          } finally {
            release.resolve(undefined);
            await blocker;
          }

          const response = await responsePromise;
          assert.equal(response.statusCode, 412);

          const [schemaRow] = await fixture.sql<
            Array<{
              currentSchemaRevision: string;
              normalizedSdl: string;
            }>
          >`
            SELECT s.current_schema_revision AS "currentSchemaRevision", ssr.normalized_sdl AS "normalizedSdl"
            FROM subgraphs AS s
            JOIN subgraph_schema_revisions AS ssr
              ON ssr.subgraph_id = s.id AND ssr.revision = s.current_schema_revision
            WHERE s.id = ${createdSubgraph.id}
          `;
          assert.deepEqual(schemaRow, {
            currentSchemaRevision: "1",
            normalizedSdl: "type Query {\n  products: [String!]!\n}\n",
          });
        },
      );
    },
  );

  await t.test(
    "graph create returns 500 when the transaction callback fails after route work completes",
    async () => {
      await withConcurrentIntegrationServer(
        {
          databaseFactory: (database) =>
            createPostCallbackFailingDatabase(database, new Error("forced post-callback failure")),
          databaseUrl: integrationDatabaseUrl,
          jwtVerification,
        },
        async (fixture) => {
          const response = await fixture.server.inject({
            headers: authorizationHeaders(createGraphManageToken()),
            method: "POST",
            payload: {
              slug: "catalog",
            },
            url: "/v1/graphs",
          });

          assert.equal(response.statusCode, 500);
          assert.equal(
            await queryCount(fixture.sql, "SELECT count(*)::int AS count FROM graphs"),
            0,
          );
          assert.equal(
            await queryCount(fixture.sql, "SELECT count(*)::int AS count FROM graph_revisions"),
            0,
          );
        },
      );
    },
  );

  await t.test("graph delete rolls back when subgraph deletion fails", async () => {
    await withConcurrentIntegrationServer(
      {
        databaseFactory: (database) =>
          createFailingDatabase(database, {
            error: new Error("forced subgraph delete failure"),
            kind: "update",
            table: subgraphs,
          }),
        databaseUrl: integrationDatabaseUrl,
        jwtVerification,
      },
      async (fixture) => {
        await createGraphThroughApi(fixture.server, createGraphManageToken());
        await createSubgraphThroughApi(fixture.server, createGraphManageToken());

        const response = await fixture.server.inject({
          headers: authorizationHeaders(createGraphManageToken()),
          method: "DELETE",
          url: "/v1/graphs/catalog",
        });

        assert.equal(response.statusCode, 500);
        assert.equal(
          await queryCount(
            fixture.sql,
            "SELECT count(*)::int AS count FROM graphs WHERE slug = 'catalog' AND deleted_at IS NULL",
          ),
          1,
        );
        assert.equal(
          await queryCount(
            fixture.sql,
            "SELECT count(*)::int AS count FROM subgraphs WHERE slug = 'inventory' AND deleted_at IS NULL",
          ),
          1,
        );
      },
    );
  });

  await t.test(
    "subgraph create rolls back when initial subgraph revision creation fails",
    async () => {
      await withConcurrentIntegrationServer(
        {
          databaseFactory: (database) =>
            createFailingDatabase(database, {
              error: new Error("forced subgraph revision insert failure"),
              kind: "insert",
              table: subgraphRevisions,
            }),
          databaseUrl: integrationDatabaseUrl,
          jwtVerification,
        },
        async (fixture) => {
          await createGraphThroughApi(fixture.server, createGraphManageToken());

          const response = await fixture.server.inject({
            headers: authorizationHeaders(createGraphManageToken()),
            method: "POST",
            payload: {
              routingUrl: "https://inventory.example.com/graphql",
              slug: "inventory",
            },
            url: "/v1/graphs/catalog/subgraphs",
          });

          assert.equal(response.statusCode, 500);
          assert.equal(
            await queryCount(fixture.sql, "SELECT count(*)::int AS count FROM subgraphs"),
            0,
          );
          assert.equal(
            await queryCount(fixture.sql, "SELECT count(*)::int AS count FROM subgraph_revisions"),
            0,
          );
        },
      );
    },
  );

  await t.test("subgraph update rolls back when advancing the subgraph pointer fails", async () => {
    await withConcurrentIntegrationServer(
      {
        databaseFactory: (database) =>
          createFailingDatabase(database, {
            error: new Error("forced subgraph pointer update failure"),
            kind: "update",
            table: subgraphs,
          }),
        databaseUrl: integrationDatabaseUrl,
        jwtVerification,
      },
      async (fixture) => {
        await createGraphThroughApi(fixture.server, createGraphManageToken());
        const createdSubgraph = await createSubgraphThroughApi(
          fixture.server,
          createGraphManageToken(),
          "catalog",
          "inventory",
          "https://inventory-v1.example.com/graphql",
        );

        const response = await fixture.server.inject({
          headers: authorizationHeaders(createGraphManageToken()),
          method: "PUT",
          payload: {
            routingUrl: "https://inventory-v2.example.com/graphql",
          },
          url: "/v1/graphs/catalog/subgraphs/inventory",
        });

        assert.equal(response.statusCode, 500);

        const [subgraphRow] = await fixture.sql<
          Array<{
            currentRevision: string;
            routingUrl: string;
          }>
        >`
          SELECT sr.routing_url AS "routingUrl", s.current_revision AS "currentRevision"
          FROM subgraphs AS s
          JOIN subgraph_revisions AS sr
            ON sr.subgraph_id = s.id AND sr.revision = s.current_revision
          WHERE s.id = ${createdSubgraph.id}
        `;
        assert.deepEqual(subgraphRow, {
          currentRevision: "1",
          routingUrl: "https://inventory-v1.example.com/graphql",
        });
        assert.equal(
          await queryCount(
            fixture.sql,
            "SELECT count(*)::int AS count FROM subgraph_revisions WHERE subgraph_id = $1",
            [createdSubgraph.id],
          ),
          1,
        );
      },
    );
  });

  await t.test(
    "subgraph schema publish returns 500 when the transaction callback fails after route work completes",
    async () => {
      let transactionCount = 0;

      await withConcurrentIntegrationServer(
        {
          databaseFactory: (database) =>
            new Proxy(database, {
              get(target, property, receiver) {
                if (property === "transaction") {
                  return async (
                    callback: (transaction: PostgresJsTransaction) => Promise<unknown>,
                  ) =>
                    target.transaction(async (transaction) => {
                      transactionCount += 1;
                      const result = await callback(transaction);
                      if (transactionCount >= 3) {
                        throw new Error("forced post-callback failure");
                      }
                      return result;
                    });
                }

                const value = Reflect.get(target, property, receiver);
                return typeof value === "function" ? value.bind(target) : value;
              },
            }),
          databaseUrl: integrationDatabaseUrl,
          jwtVerification,
        },
        async (fixture) => {
          const createdGraph = await createGraphThroughApi(
            fixture.server,
            createGraphManageToken(),
          );
          const createdSubgraph = await createSubgraphThroughApi(
            fixture.server,
            createGraphManageToken(),
          );
          const schemaWriteToken = createSubgraphSchemaGrantToken(
            jwtSigner.createToken,
            "subgraph_schema:write",
            createdGraph.id,
            createdSubgraph.id,
          );

          const response = await fixture.server.inject({
            headers: {
              authorization: `Bearer ${schemaWriteToken}`,
              "content-type": "text/plain",
            },
            method: "POST",
            payload: "type Query { products: [String!]! }",
            url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
          });

          assert.equal(response.statusCode, 500);
          assert.equal(
            await queryCount(
              fixture.sql,
              "SELECT count(*)::int AS count FROM subgraph_schema_revisions WHERE subgraph_id = $1",
              [createdSubgraph.id],
            ),
            0,
          );

          const [subgraphRow] = await fixture.sql<Array<{ currentSchemaRevision: string | null }>>`
            SELECT current_schema_revision AS "currentSchemaRevision"
            FROM subgraphs
            WHERE id = ${createdSubgraph.id}
          `;
          assert.deepEqual(subgraphRow, {
            currentSchemaRevision: null,
          });
        },
      );
    },
  );

  await t.test("subgraph delete rolls back when the delete update fails", async () => {
    await withConcurrentIntegrationServer(
      {
        databaseFactory: (database) =>
          createFailingDatabase(database, {
            error: new Error("forced subgraph delete update failure"),
            kind: "update",
            table: subgraphs,
          }),
        databaseUrl: integrationDatabaseUrl,
        jwtVerification,
      },
      async (fixture) => {
        await createGraphThroughApi(fixture.server, createGraphManageToken());
        await createSubgraphThroughApi(fixture.server, createGraphManageToken());

        const response = await fixture.server.inject({
          headers: authorizationHeaders(createGraphManageToken()),
          method: "DELETE",
          url: "/v1/graphs/catalog/subgraphs/inventory",
        });

        assert.equal(response.statusCode, 500);
        assert.equal(
          await queryCount(
            fixture.sql,
            "SELECT count(*)::int AS count FROM subgraphs WHERE slug = 'inventory' AND deleted_at IS NULL",
          ),
          1,
        );
      },
    );
  });
});
