import assert from "node:assert/strict";
import test from "node:test";

import type { AuthorizationGrant, RequestUser } from "../../../domain/authorization/user.ts";
import { bearerAuthenticateHeaders } from "./bearer-authenticate-headers.ts";
import { requireAuthenticatedUser } from "./guards.ts";

type GuardRequest = Parameters<typeof requireAuthenticatedUser>[0];
type ProblemDetailsCall = Parameters<
  Parameters<typeof requireAuthenticatedUser<ReplySpy>>[1]["problemDetails"]
>[0];

type ReplySpy = {
  calls: ProblemDetailsCall[];
  problemDetails(options: ProblemDetailsCall): ReplySpy;
};

function createReplySpy(): ReplySpy {
  return {
    calls: [],
    problemDetails(this: ReplySpy, options): ReplySpy {
      this.calls.push(options);
      return this;
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
    const user = createUser({ graphId: "*", scope: "graph:manage" });
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
