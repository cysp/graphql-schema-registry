import assert from "node:assert/strict";
import test from "node:test";

import type { AuthorizationGrant, RequestUser } from "../../../domain/authorization/user.ts";
import { bearerAuthenticateHeaders } from "./bearer-authenticate-headers.ts";
import {
  hasSubgraphSchemaWriteGrant,
  requireAdminGrant,
  requireAuthenticatedUser,
  requireGraphReadGrant,
  requireSubgraphSchemaReadGrant,
  requireSubgraphWriteGrant,
} from "./guards.ts";

type GuardRequest = Parameters<typeof requireAuthenticatedUser>[0];
type GuardReply = Parameters<typeof requireAuthenticatedUser>[1];
type ProblemDetailsCall = Parameters<GuardReply["problemDetails"]>[0];

type ReplySpy = GuardReply & {
  calls: ProblemDetailsCall[];
};

function createReplySpy(): ReplySpy {
  return {
    calls: [],
    problemDetails(options): void {
      this.calls.push(options);
    },
  };
}

function createRequest(user?: RequestUser): GuardRequest {
  return { user };
}

function createUser(...grants: readonly AuthorizationGrant[]): RequestUser {
  return { grants };
}

await test("requireAuthenticatedUser", async (t) => {
  await t.test("returns the authenticated user without writing a response", () => {
    const user = createUser({ scope: "admin" });
    const request = createRequest(user);
    const reply = createReplySpy();

    const result = requireAuthenticatedUser(request, reply);

    assert.equal(result, user);
    assert.deepStrictEqual(reply.calls, []);
  });

  await t.test("returns 401 with bearer auth headers when no user is present", () => {
    const request = createRequest();
    const reply = createReplySpy();

    const result = requireAuthenticatedUser(request, reply);

    assert.equal(result, undefined);
    assert.deepStrictEqual(reply.calls, [
      {
        headers: bearerAuthenticateHeaders,
        status: 401,
      },
    ]);
  });
});

await test("grant guards", async (t) => {
  await t.test("return 401 for unauthenticated requests", async (t) => {
    const cases = [
      {
        guard: (request: GuardRequest, reply: GuardReply) => requireAdminGrant(request, reply),
        name: "requireAdminGrant",
      },
      {
        guard: (request: GuardRequest, reply: GuardReply) =>
          requireGraphReadGrant(request, reply, "alpha"),
        name: "requireGraphReadGrant",
      },
      {
        guard: (request: GuardRequest, reply: GuardReply) =>
          requireSubgraphWriteGrant(request, reply, "alpha", "inventory"),
        name: "requireSubgraphWriteGrant",
      },
      {
        guard: (request: GuardRequest, reply: GuardReply) =>
          requireSubgraphSchemaReadGrant(request, reply, "alpha", "inventory"),
        name: "requireSubgraphSchemaReadGrant",
      },
    ] as const;

    for (const { name, guard } of cases) {
      await t.test(name, () => {
        const request = createRequest();
        const reply = createReplySpy();

        const result = guard(request, reply);

        assert.equal(result, undefined);
        assert.deepStrictEqual(reply.calls, [
          {
            headers: bearerAuthenticateHeaders,
            status: 401,
          },
        ]);
      });
    }
  });

  await t.test("return the user when a matching grant is present", async (t) => {
    const cases = [
      {
        guard: (request: GuardRequest, reply: GuardReply) => requireAdminGrant(request, reply),
        name: "requireAdminGrant",
        user: createUser({ scope: "admin" }, { graphId: "beta", scope: "graph:read" }),
      },
      {
        guard: (request: GuardRequest, reply: GuardReply) =>
          requireGraphReadGrant(request, reply, "alpha"),
        name: "requireGraphReadGrant",
        user: createUser(
          { graphId: "beta", scope: "graph:read" },
          { graphId: "alpha", scope: "graph:read" },
        ),
      },
      {
        guard: (request: GuardRequest, reply: GuardReply) =>
          requireSubgraphWriteGrant(request, reply, "alpha", "inventory"),
        name: "requireSubgraphWriteGrant",
        user: createUser(
          { graphId: "alpha", scope: "subgraph:write", subgraphId: "other" },
          { graphId: "alpha", scope: "subgraph:write", subgraphId: "inventory" },
        ),
      },
      {
        guard: (request: GuardRequest, reply: GuardReply) =>
          requireSubgraphSchemaReadGrant(request, reply, "alpha", "inventory"),
        name: "requireSubgraphSchemaReadGrant",
        user: createUser(
          { graphId: "alpha", scope: "subgraph-schema:read", subgraphId: "other" },
          { graphId: "alpha", scope: "subgraph-schema:read", subgraphId: "inventory" },
        ),
      },
    ] as const;

    for (const { name, guard, user } of cases) {
      await t.test(name, () => {
        const request = createRequest(user);
        const reply = createReplySpy();

        const result = guard(request, reply);

        assert.equal(result, user);
        assert.deepStrictEqual(reply.calls, []);
      });
    }
  });

  await t.test("return 403 when no matching grant is present", async (t) => {
    const cases = [
      {
        guard: (request: GuardRequest, reply: GuardReply) => requireAdminGrant(request, reply),
        name: "requireAdminGrant",
        user: createUser({ graphId: "alpha", scope: "graph:read" }),
      },
      {
        guard: (request: GuardRequest, reply: GuardReply) =>
          requireGraphReadGrant(request, reply, "alpha"),
        name: "requireGraphReadGrant",
        user: createUser({ graphId: "beta", scope: "graph:read" }, { scope: "admin" }),
      },
      {
        guard: (request: GuardRequest, reply: GuardReply) =>
          requireSubgraphWriteGrant(request, reply, "alpha", "inventory"),
        name: "requireSubgraphWriteGrant",
        user: createUser(
          { graphId: "alpha", scope: "subgraph:write", subgraphId: "other" },
          { graphId: "beta", scope: "subgraph:write", subgraphId: "inventory" },
        ),
      },
      {
        guard: (request: GuardRequest, reply: GuardReply) =>
          requireSubgraphSchemaReadGrant(request, reply, "alpha", "inventory"),
        name: "requireSubgraphSchemaReadGrant",
        user: createUser(
          { graphId: "alpha", scope: "subgraph-schema:read", subgraphId: "other" },
          { graphId: "beta", scope: "subgraph-schema:read", subgraphId: "inventory" },
          { scope: "admin" },
        ),
      },
    ] as const;

    for (const { name, guard, user } of cases) {
      await t.test(name, () => {
        const request = createRequest(user);
        const reply = createReplySpy();

        const result = guard(request, reply);

        assert.equal(result, undefined);
        assert.deepStrictEqual(reply.calls, [{ status: 403 }]);
      });
    }
  });
});

await test("hasSubgraphSchemaWriteGrant", async (t) => {
  await t.test("returns true when a matching grant is present", () => {
    const user = createUser(
      { graphId: "alpha", scope: "subgraph-schema:write", subgraphId: "other" },
      { graphId: "alpha", scope: "subgraph-schema:write", subgraphId: "inventory" },
    );

    assert.equal(hasSubgraphSchemaWriteGrant(user, "alpha", "inventory"), true);
  });

  await t.test("returns false when no matching grant is present", () => {
    const user = createUser(
      { graphId: "alpha", scope: "subgraph-schema:write", subgraphId: "other" },
      { graphId: "beta", scope: "subgraph-schema:write", subgraphId: "inventory" },
      { scope: "admin" },
    );

    assert.equal(hasSubgraphSchemaWriteGrant(user, "alpha", "inventory"), false);
  });
});
