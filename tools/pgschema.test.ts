import assert from "node:assert/strict";
import test from "node:test";

import { createPgschemaEnvironment } from "./pgschema.ts";

await test("createPgschemaEnvironment", async (t) => {
  await t.test("maps DATABASE_URL parts into libpq environment variables", () => {
    assert.deepStrictEqual(
      createPgschemaEnvironment(
        "postgresql://service:secret@localhost:5432/graphql_schema_registry?sslmode=disable",
      ),
      {
        PGDATABASE: "graphql_schema_registry",
        PGHOST: "localhost",
        PGPASSWORD: "secret",
        PGPORT: "5432",
        PGSSLMODE: "disable",
        PGUSER: "service",
      },
    );
  });

  await t.test("decodes encoded credentials and database names", () => {
    assert.deepStrictEqual(
      createPgschemaEnvironment(
        "postgresql://service%40local:p%40ss@127.0.0.1/graph%20registry",
      ),
      {
        PGDATABASE: "graph registry",
        PGHOST: "127.0.0.1",
        PGPASSWORD: "p@ss",
        PGUSER: "service@local",
      },
    );
  });

  await t.test("rejects non-postgres URLs", () => {
    assert.throws(
      () => {
        createPgschemaEnvironment("mysql://service:secret@localhost:5432/graphql_schema_registry");
      },
      {
        message: /DATABASE_URL must use the postgres:\/\/ or postgresql:\/\//,
      },
    );
  });

  await t.test("rejects missing database names", () => {
    assert.throws(
      () => {
        createPgschemaEnvironment("postgresql://service:secret@localhost");
      },
      {
        message: /DATABASE_URL must include a database name/,
      },
    );
  });

  await t.test("rejects missing users", () => {
    assert.throws(
      () => {
        createPgschemaEnvironment("postgresql://localhost/graphql_schema_registry");
      },
      {
        message: /DATABASE_URL must include a database user/,
      },
    );
  });
});
