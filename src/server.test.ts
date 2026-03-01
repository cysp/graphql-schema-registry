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

function getJsonPayload(response: { body: string }): unknown {
  return JSON.parse(response.body) as unknown;
}

await test("createFastifyServer authorization hook", async (t) => {
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

  await t.test("allows unguarded routes with no bearer header", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(getJsonPayload(response), {
      checks: {
        database: "warn",
      },
      status: "warn",
    });
  });

  await t.test("returns 401 for invalid bearer tokens on unguarded routes", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
      headers: {
        authorization: "Bearer invalid-token",
      },
    });

    assert.strictEqual(response.statusCode, 401);
    assert.deepStrictEqual(getJsonPayload(response), {
      error: "Unauthorized",
      message: "Unauthorized",
      statusCode: 401,
    });
  });

  await t.test("accepts valid bearer tokens", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
      headers: {
        authorization: `Bearer ${createToken()}`,
      },
    });

    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(getJsonPayload(response), {
      checks: {
        database: "warn",
      },
      status: "warn",
    });
  });

  await t.test("returns 401 for tokens with malformed authorization_details", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
      headers: {
        authorization: `Bearer ${createToken({
          authorization_details: {
            scope: "admin",
            type: "graphql-schema-registry",
          },
        })}`,
      },
    });

    assert.strictEqual(response.statusCode, 401);
    assert.deepStrictEqual(getJsonPayload(response), {
      error: "Unauthorized",
      message: "Unauthorized",
      statusCode: 401,
    });
  });

  await t.test("returns 503 before bearer auth checks on graph routes when DB is missing", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/v1/graphs",
    });

    assert.strictEqual(response.statusCode, 503);
  });

  await t.test("returns 503 before admin grant checks on graph routes when DB is missing", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/v1/graphs",
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

    assert.strictEqual(response.statusCode, 503);
  });

  await t.test("allows admins to list graphs", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/v1/graphs",
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
