import assert from "node:assert/strict";
import test from "node:test";

import { composeServices } from "@apollo/composition";
import { parse } from "graphql";

function schemaForQueryField(fieldName: string): string {
  return `
    extend schema
      @link(url: "https://specs.apollo.dev/federation/v2.13", import: ["@key"])

    type Query {
      ${fieldName}: Int
    }
  `;
}

function composeForSubgraphNames(names: readonly string[]) {
  return composeServices(
    names.map((name, index) => ({
      name,
      typeDefs: parse(schemaForQueryField(`field${index}`)),
      url: `https://subgraph-${index}.example.com/graphql`,
    })),
  );
}

await test("subgraph slug composition boundary around GraphQL Name validity", async (t) => {
  await t.test("accepts a GraphQL Name-compatible subgraph slug", () => {
    const result = composeForSubgraphNames(["inventory_v2"]);
    assert.equal(result.errors, undefined);
    assert.match(result.supergraphSdl, /@join__graph\(name: "inventory_v2"/);
  });

  await t.test(
    "accepts non-GraphQL-Name subgraph slugs and preserves original names",
    async (t) => {
      const names = ["inventory-v2", "2inventory", "inventory.catalog"];

      for (const name of names) {
        await t.test(name, () => {
          const result = composeForSubgraphNames([name]);

          assert.equal(result.errors, undefined);
          assert.match(result.supergraphSdl, new RegExp(`@join__graph\\(name: "${name}"`));
        });
      }
    },
  );

  await t.test("disambiguates GraphQL-enum-name collisions derived from subgraph slugs", () => {
    const result = composeForSubgraphNames(["a.b", "a_b"]);

    assert.equal(result.errors, undefined);
    assert.match(result.supergraphSdl, /A_B_1 @join__graph\(name: "a\.b"/);
    assert.match(result.supergraphSdl, /A_B_2 @join__graph\(name: "a_b"/);
  });
});
