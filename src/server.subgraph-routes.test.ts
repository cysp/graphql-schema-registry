import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import { authorizationDetailsType } from "./domain/authorization/details.ts";
import { createFastifyServer } from "./server.ts";

type JwtClaims = Record<string, unknown>;
type JwtHeader = Record<string, unknown>;

type RouteCase = {
  method: "DELETE" | "GET" | "PUT";
  payload?: Record<string, unknown>;
  requiresRevisionHeader?: boolean;
  url: string;
};

type InjectOptions = {
  headers?: Record<string, string>;
  method: RouteCase["method"];
  payload?: Record<string, unknown>;
  url: string;
};

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

function createInjectOptions(routeCase: RouteCase, authorizationToken?: string): InjectOptions {
  const options: InjectOptions = {
    method: routeCase.method,
    url: routeCase.url,
  };

  if (routeCase.payload !== undefined) {
    options.payload = routeCase.payload;
  }

  const headers: Record<string, string> = {};
  if (authorizationToken !== undefined) {
    headers["authorization"] = `Bearer ${authorizationToken}`;
  }

  if (routeCase.requiresRevisionHeader) {
    headers["x-revision-id"] = "1";
  }

  if (Object.keys(headers).length > 0) {
    options.headers = headers;
  }

  return options;
}

await test("subgraph routes authorization", async (t) => {
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

  const routeCases: readonly RouteCase[] = [
    {
      method: "GET",
      url: "/v1/graphs/catalog/subgraphs",
    },
    {
      method: "GET",
      url: "/v1/graphs/catalog/subgraphs/inventory",
    },
    {
      method: "PUT",
      payload: {
        routingUrl: "https://example.com/graphql",
      },
      requiresRevisionHeader: true,
      url: "/v1/graphs/catalog/subgraphs/inventory",
    },
    {
      method: "DELETE",
      url: "/v1/graphs/catalog/subgraphs/inventory",
    },
  ];

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

  const graphReaderToken = createToken({
    authorization_details: [
      {
        graph_id: "00000000-0000-4000-8000-000000000001",
        scope: "graph:read",
        type: authorizationDetailsType,
      },
    ],
  });
  const adminToken = createToken({
    authorization_details: [
      {
        scope: "admin",
        type: authorizationDetailsType,
      },
    ],
  });

  t.afterEach(async () => {
    await server.close();
  });

  await t.test("requires bearer auth on all subgraph routes", async () => {
    for (const routeCase of routeCases) {
      const response = await server.inject(createInjectOptions(routeCase));
      assert.strictEqual(response.statusCode, 401);
    }
  });

  await t.test("requires admin grant on all subgraph routes", async () => {
    for (const routeCase of routeCases) {
      const response = await server.inject(createInjectOptions(routeCase, graphReaderToken));
      assert.strictEqual(response.statusCode, 403);
    }
  });

  await t.test("allows admins to reach all subgraph handlers", async () => {
    for (const routeCase of routeCases) {
      const response = await server.inject(createInjectOptions(routeCase, adminToken));
      assert.strictEqual(response.statusCode, 501);
    }
  });
});
