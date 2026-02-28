import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import { authorizationDetailsType } from "./domain/authorization/details.ts";
import { createFastifyServer } from "./server.ts";

type JwtClaims = Record<string, unknown>;
type JwtHeader = Record<string, unknown>;

function createDefaultClaims(): JwtClaims {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    aud: "graphql-schema-registry",
    authorization_details: [],
    exp: nowSeconds + 300,
    iat: nowSeconds - 10,
    iss: "https://auth.example.com",
    nbf: nowSeconds - 10,
  };
}

function encodeBase64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function createSignedJwt({
  claims,
  header,
  privateKey,
}: {
  claims: JwtClaims;
  header: JwtHeader;
  privateKey: string | Buffer;
}): string {
  const encodedHeader = encodeBase64urlJson(header);
  const encodedClaims = encodeBase64urlJson(claims);
  const signedPayload = `${encodedHeader}.${encodedClaims}`;
  const signature = sign("RSA-SHA256", Buffer.from(signedPayload, "utf8"), privateKey).toString(
    "base64url",
  );

  return `${signedPayload}.${signature}`;
}

await test("graph routes authorization", async (t) => {
  let server: ReturnType<typeof createFastifyServer>;

  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" });
  const exportedPublicKey = publicKey.export({ format: "pem", type: "spki" });
  const publicKeyPem =
    typeof exportedPublicKey === "string"
      ? Buffer.from(exportedPublicKey, "utf8")
      : exportedPublicKey;

  const jwtVerification = {
    audience: "graphql-schema-registry",
    issuer: "https://auth.example.com",
    verificationPublicKey: publicKeyPem,
  };

  t.beforeEach(async () => {
    server = createFastifyServer({
      jwtVerification,
    });
    await server.ready();
  });

  function createToken(claimsOverrides: JwtClaims = {}): string {
    const claims = Object.assign(createDefaultClaims(), claimsOverrides);

    return createSignedJwt({
      claims,
      header: {
        alg: "RS256",
        typ: "JWT",
      },
      privateKey: privateKeyPem,
    });
  }

  t.afterEach(async () => {
    await server.close();
  });

  await t.test("requires bearer auth to get a graph", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/v1/graphs/catalog",
    });

    assert.strictEqual(response.statusCode, 401);
  });

  await t.test("requires bearer auth to upsert a graph", async () => {
    const response = await server.inject({
      method: "PUT",
      url: "/v1/graphs/catalog",
      headers: {
        "x-revision-id": "0",
      },
      payload: {
        federationVersion: "2.9",
      },
    });

    assert.strictEqual(response.statusCode, 401);
  });

  await t.test("requires bearer auth to delete a graph", async () => {
    const response = await server.inject({
      method: "DELETE",
      url: "/v1/graphs/catalog",
    });

    assert.strictEqual(response.statusCode, 401);
  });

  await t.test("requires admin grant to upsert a graph", async () => {
    const response = await server.inject({
      method: "PUT",
      url: "/v1/graphs/catalog",
      headers: {
        authorization: `Bearer ${createToken({
          authorization_details: [
            {
              graph_id: "00000000-0000-4000-8000-000000000001",
              scope: "graph:read",
              type: authorizationDetailsType,
            },
          ],
        })}`,
        "x-revision-id": "0",
      },
      payload: {
        federationVersion: "2.9",
      },
    });

    assert.strictEqual(response.statusCode, 403);
  });

  await t.test("requires admin grant to delete a graph", async () => {
    const response = await server.inject({
      method: "DELETE",
      url: "/v1/graphs/catalog",
      headers: {
        authorization: `Bearer ${createToken({
          authorization_details: [
            {
              graph_id: "00000000-0000-4000-8000-000000000001",
              scope: "graph:read",
              type: authorizationDetailsType,
            },
          ],
        })}`,
      },
    });

    assert.strictEqual(response.statusCode, 403);
  });

  await t.test("allows authenticated graph readers to reach get graph handler", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/v1/graphs/catalog",
      headers: {
        authorization: `Bearer ${createToken({
          authorization_details: [
            {
              graph_id: "00000000-0000-4000-8000-000000000001",
              scope: "graph:read",
              type: authorizationDetailsType,
            },
          ],
        })}`,
      },
    });

    // No database is configured in this test setup, so authenticated access
    // reaches the handler and returns service unavailable.
    assert.strictEqual(response.statusCode, 503);
  });

  await t.test("allows admins to reach upsert graph handler", async () => {
    const response = await server.inject({
      method: "PUT",
      url: "/v1/graphs/catalog",
      headers: {
        authorization: `Bearer ${createToken({
          authorization_details: [
            {
              scope: "admin",
              type: authorizationDetailsType,
            },
          ],
        })}`,
        "x-revision-id": "0",
      },
      payload: {
        federationVersion: "2.9",
      },
    });

    // No database is configured in this test setup, so authorized access reaches
    // the handler and returns service unavailable.
    assert.strictEqual(response.statusCode, 503);
  });

  await t.test("allows admins to reach delete graph handler", async () => {
    const response = await server.inject({
      method: "DELETE",
      url: "/v1/graphs/catalog",
      headers: {
        authorization: `Bearer ${createToken({
          authorization_details: [
            {
              scope: "admin",
              type: authorizationDetailsType,
            },
          ],
        })}`,
      },
    });

    // No database is configured in this test setup, so authorized access reaches
    // the handler and returns service unavailable.
    assert.strictEqual(response.statusCode, 503);
  });
});
